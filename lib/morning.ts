/**
 * Morning (Green Invoice) API Client
 *
 * Integrates with the Morning (formerly Green Invoice) platform to generate
 * and send receipts automatically after successful payments.
 *
 * API Docs: https://www.greeninvoice.co.il/api-docs
 * Base URL (prod): https://api.greeninvoice.co.il/api/v1/
 * Base URL (sandbox): https://sandbox.d.greeninvoice.co.il/api/v1/
 */

// ─── Configuration ──────────────────────────────────────────────────────────────

const getConfig = () => ({
  apiKey: process.env.MORNING_API_KEY || '',
  apiSecret: process.env.MORNING_API_SECRET || '',
  baseUrl: process.env.MORNING_SANDBOX === 'true'
    ? 'https://sandbox.d.greeninvoice.co.il/api/v1'
    : 'https://api.greeninvoice.co.il/api/v1',
})

// ─── Document types ─────────────────────────────────────────────────────────────
// 305 = Tax Invoice
// 320 = Tax Invoice + Receipt (חשבונית מס/קבלה)
// 400 = Receipt (קבלה)
const RECEIPT_DOC_TYPE = 320

// ─── Payment method mapping ─────────────────────────────────────────────────────
// Morning payment type codes:
// 1 = Cash (מזומן)
// 2 = Check (שיק)
// 3 = Credit Card (כרטיס אשראי)
// 4 = Bank Transfer (העברה בנקאית)
// 5 = PayPal
// 10 = Other (אחר)
const PAYMENT_TYPE_MAP: Record<string, number> = {
  card: 3,        // Credit card
  credit_card: 3,
  bit: 10,        // Bit → Other (no specific Bit type in Morning)
  gift_card: 10,  // Gift card → Other
  test_card: 3,   // Test card → Credit card
  cash: 1,
  check: 2,
  bank_transfer: 4,
  paypal: 5,
}

// ─── Token cache ────────────────────────────────────────────────────────────────

let cachedToken: string | null = null
let tokenExpiresAt = 0 // Unix timestamp (ms)

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface MorningReceiptParams {
  /** Customer email — receipt will be sent to this address */
  customerEmail: string
  /** Customer full name */
  customerName: string
  /** Total payment amount (in the currency specified) */
  amount: number
  /** Currency code, e.g. 'ILS', 'USD' */
  currency?: string
  /** Payment method from Tranzila: 'card', 'bit', 'gift_card', etc. */
  paymentMethod?: string
  /** Line items description (optional — falls back to generic description) */
  description?: string
  /** Individual line items (optional) */
  items?: {
    description: string
    quantity: number
    price: number
  }[]
  /** Payment date (ISO string). Defaults to now. */
  paymentDate?: string
  /** Language for the receipt: 'he' (Hebrew) or 'en' (English). Defaults to 'he'. */
  lang?: 'he' | 'en'
}

export interface MorningReceiptResult {
  success: boolean
  documentId?: string
  documentUrl?: string
  error?: string
}

// ─── Authentication ─────────────────────────────────────────────────────────────

/**
 * Authenticate with Morning API and retrieve a JWT token.
 * Caches the token and refreshes it when expired (tokens are valid for ~1 hour).
 */
async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 2 min buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 120_000) {
    return cachedToken
  }

  const { apiKey, apiSecret, baseUrl } = getConfig()

  if (!apiKey || !apiSecret) {
    throw new Error('[MORNING] Missing MORNING_API_KEY or MORNING_API_SECRET environment variables')
  }

  // Morning retired the legacy `${baseUrl}/account/token` endpoint (now 404).
  // Tokens are issued by the OAuth 2.0 identity service on a separate host.
  const idpUrl = process.env.MORNING_SANDBOX === 'true'
    ? 'https://api.sandbox.morning.dev/idp/v1/oauth/token'
    : 'https://api.morning.co/idp/v1/oauth/token'

  console.log(`[MORNING] Requesting new access token from ${idpUrl}`)

  const response = await fetch(idpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: apiKey,
      client_secret: apiSecret,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`[MORNING] Authentication failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  if (!data.accessToken) {
    throw new Error('[MORNING] Authentication response missing accessToken')
  }
  cachedToken = data.accessToken
  // expiresAt is a Unix timestamp in seconds
  tokenExpiresAt = typeof data.expiresAt === 'number'
    ? data.expiresAt * 1000
    : Date.now() + 55 * 60 * 1000

  console.log('[MORNING] Access token obtained successfully')
  return cachedToken!
}

// ─── Receipt creation ───────────────────────────────────────────────────────────

/**
 * Create and send a receipt to the customer via the Morning API.
 *
 * This creates a document of type 400 (Receipt) with the payment details
 * and sends it to the customer's email address.
 *
 * @param params - Receipt parameters (customer info, amount, payment method, etc.)
 * @returns Result with document ID and URL on success, or error on failure.
 */
export async function sendMorningReceipt(
  params: MorningReceiptParams
): Promise<MorningReceiptResult> {
  const {
    customerEmail,
    customerName,
    amount,
    currency = 'ILS',
    paymentMethod = 'card',
    description,
    items,
    paymentDate,
    lang = 'he',
  } = params

  // Validate required fields
  if (!customerEmail || !amount) {
    console.warn('[MORNING] Missing email or amount — skipping receipt')
    return { success: false, error: 'Missing required fields (email or amount)' }
  }

  const { apiKey, apiSecret, baseUrl } = getConfig()

  if (!apiKey || !apiSecret) {
    console.warn('[MORNING] API credentials not configured — skipping receipt')
    return { success: false, error: 'Morning API credentials not configured' }
  }

  try {
    const token = await getAccessToken()

    // Map the Tranzila payment method to a Morning payment type code
    const morningPaymentType = PAYMENT_TYPE_MAP[paymentMethod] ?? PAYMENT_TYPE_MAP['card']

    // Format the payment date (YYYY-MM-DD)
    const payDate = paymentDate
      ? new Date(paymentDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]

    // VAT: Israeli customers (Hebrew checkout) get VAT shown, already included in the price.
    // Customers abroad (English checkout) are VAT-exempt — the amount stays exactly as paid.
    const isIsrael = lang === 'he'
    // ItemVatType: 1 = VAT included in price, 2 = Exempt
    const itemVatType = isIsrael ? 1 : 2

    // Build line items (income array)
    const income = items && items.length > 0
      ? items.map(item => ({
          catalogNum: '',
          description: item.description,
          quantity: item.quantity,
          price: item.price,
          currency: getCurrencyCode(currency),
          vatType: itemVatType,
        }))
      : [
          {
            catalogNum: '',
            description: description || 'Purchase',
            quantity: 1,
            price: amount,
            currency: getCurrencyCode(currency),
            vatType: itemVatType,
          },
        ]

    // Morning error 2422: sum(income) must equal amount exactly.
    // Cart items only cover the subtotal; shipping fee is included in `amount` but not in items.
    // If there is a gap, append a balancing "Shipping" line so the totals match.
    const incomeSum = Math.round(income.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100
    const roundedAmount = Math.round(amount * 100) / 100
    const shippingGap = Math.round((roundedAmount - incomeSum) * 100) / 100
    if (shippingGap < 0) {
      // Discount (Shopify cart code / checkout coupon): items are at full price
      // but the customer paid less. Without this, sum(income) > amount and
      // Morning rejects the document (error 2422) — no invoice at all.
      applyDiscountToIncome(income, roundedAmount)
    } else if (shippingGap > 0) {
      income.push({
        catalogNum: '',
        description: lang === 'he' ? 'משלוח' : 'Shipping',
        quantity: 1,
        price: shippingGap,
        currency: getCurrencyCode(currency),
        vatType: itemVatType,
      })
    }

    const remarksText = lang === 'he' ? 'תתחדשי!' : 'Wear it well!'

    // Build the document payload
    const documentPayload = {
      type: RECEIPT_DOC_TYPE,
      date: payDate,
      dueDate: payDate,
      lang,
      currency: getCurrencyCode(currency),
      vatType: isIsrael ? 0 : 1, // DocumentVatType 0 = Default (based on business type), 1 = Exempt
      amount,
      emailContent: remarksText,
      // Client (recipient) info
      client: {
        name: customerName,
        emails: [customerEmail],
        add: true, // Auto-create client if not found
      },
      // Trigger email sending — remarks appears as the personal message in the email body
      email: {
        to: [
          {
            email: customerEmail,
          }
        ],
        lang: lang,
        remarks: remarksText,
      },
      // Line items
      income,
      // Payment details (required for type 320 Tax Invoice/Receipt)
      payment: [
        {
          type: morningPaymentType,
          price: amount,
          currency: getCurrencyCode(currency),
          date: payDate,
        },
      ],
      // Remarks on the document itself
      remarks: remarksText,
      // Footer
      footer: '',
    }

    console.log(`[MORNING] Creating receipt for ${customerEmail} | amount: ${amount} ${currency} | type: ${morningPaymentType} | emailContent: "${remarksText}"`)
    console.log('[MORNING] Full email object being sent:', JSON.stringify(documentPayload.email, null, 2))

    const response = await fetch(`${baseUrl}/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(documentPayload),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`[MORNING] Document creation failed (${response.status}):`, errorBody)

      // If token expired, clear cache and retry once
      if (response.status === 401) {
        console.log('[MORNING] Token expired — clearing cache and retrying...')
        cachedToken = null
        tokenExpiresAt = 0
        return sendMorningReceipt(params)
      }

      return {
        success: false,
        error: `Morning API error (${response.status}): ${errorBody}`,
      }
    }

    const result = await response.json()
    const documentId = result.id || result._id
    
    let documentUrl = result.url || result.shareUrl || (documentId ? `${baseUrl}/documents/${documentId}` : undefined)
    if (documentUrl && typeof documentUrl === 'object') {
      documentUrl = documentUrl.he || documentUrl.en || JSON.stringify(documentUrl)
    }

    console.log(`[MORNING] ✅ Receipt created successfully | docId: ${documentId} | email: ${customerEmail}`)

    return {
      success: true,
      documentId,
      documentUrl,
    }
  } catch (error: any) {
    console.error('[MORNING] Exception while creating receipt:', error?.message || error)
    return {
      success: false,
      error: error?.message || 'Unknown error',
    }
  }
}

/**
 * Logging wrapper around `sendMorningReceipt`.
 *
 * `sendMorningReceipt` reports failure by *resolving* with `{ success: false }`
 * rather than throwing — so a bare `.catch()` on the call never runs and the
 * failure leaves no trace in the route logs. Always go through this helper so
 * every outcome is logged against the calling route.
 *
 * Never rejects: a receipt problem must not take down a paid checkout.
 *
 * @param tag - Route log prefix, e.g. `[CALLBACK][${logId}]`
 */
export function sendMorningReceiptLogged(
  tag: string,
  params: MorningReceiptParams
): Promise<MorningReceiptResult> {
  return sendMorningReceipt(params)
    .then(result => {
      if (result.success) {
        console.log(`${tag} Morning receipt created — docId: ${result.documentId}`)
      } else {
        console.error(`${tag} Morning receipt failed (non-fatal): ${result.error}`)
      }
      return result
    })
    .catch((morningErr: any) => {
      // Only reachable if sendMorningReceipt itself throws outside its own try/catch.
      const error = morningErr?.message || String(morningErr)
      console.error(`${tag} Morning receipt threw (non-fatal): ${error}`)
      return { success: false, error }
    })
}

// ─── Document search ────────────────────────────────────────────────────────────

export interface MorningDocumentSummary {
  id: string
  number: string
  type: number
  documentDate: string   // YYYY-MM-DD
  amount: number
  currency: string
  clientName: string
  emails: string[]       // lower-cased
  url?: string
}

/**
 * All documents issued between two dates (YYYY-MM-DD, inclusive).
 * Read-only — used to find which paid orders never got an invoice.
 */
export async function searchMorningDocuments(fromDate: string, toDate: string): Promise<MorningDocumentSummary[]> {
  const { baseUrl } = getConfig()
  const out: MorningDocumentSummary[] = []
  let retried = false

  for (let page = 1; page <= 100; page++) {
    const token = await getAccessToken()
    const res = await fetch(`${baseUrl}/documents/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fromDate, toDate, page, pageSize: 100 }),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 401 && !retried) {
      retried = true
      cachedToken = null
      tokenExpiresAt = 0
      page--
      continue
    }
    if (!res.ok) throw new Error(`[MORNING] Document search failed (${res.status}): ${(await res.text()).slice(0, 300)}`)

    const data = await res.json()
    for (const d of data.items || []) {
      const url = typeof d.url === 'object' ? (d.url?.he || d.url?.origin || d.url?.en) : d.url
      out.push({
        id: String(d.id),
        number: String(d.number ?? ''),
        type: Number(d.type),
        documentDate: String(d.documentDate || ''),
        amount: Number(d.amount) || 0,
        currency: String(d.currency || 'ILS').toUpperCase(),
        clientName: d.client?.name || '',
        emails: (d.client?.emails || []).map((e: string) => String(e).trim().toLowerCase()),
        url: url || undefined,
      })
    }
    if (!data.pages || page >= data.pages) break
  }
  return out
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Spread a discount over the line items, in place, so that
 * sum(price × quantity) equals `target` to the agorot.
 *
 * Unit prices are scaled proportionally; the rounding residual goes on a
 * quantity-1 line, or on one unit split off the last line.
 */
export function applyDiscountToIncome(
  income: { description: string; quantity: number; price: number; [k: string]: any }[],
  target: number
): void {
  const sum = income.reduce((s, i) => s + i.price * i.quantity, 0)
  if (income.length === 0 || sum <= 0 || target >= sum) return

  const factor = target / sum
  for (const line of income) line.price = round2(line.price * factor)

  const residual = round2(target - income.reduce((s, i) => s + i.price * i.quantity, 0))
  if (residual === 0) return

  const single = income.find(i => i.quantity === 1)
  if (single) {
    single.price = round2(single.price + residual)
    return
  }
  const last = income[income.length - 1]
  last.quantity -= 1
  income.push({ ...last, quantity: 1, price: round2(last.price + residual) })
}

/**
 * Map common currency strings to the Morning/Green Invoice currency code.
 * Morning uses standard ISO 4217 codes.
 */
function getCurrencyCode(currency: string): string {
  const map: Record<string, string> = {
    ILS: 'ILS',
    USD: 'USD',
    EUR: 'EUR',
    GBP: 'GBP',
  }
  return map[currency.toUpperCase()] || currency.toUpperCase()
}

/**
 * Determines the payment method string for Morning based on how the payment
 * was processed (reading from session data).
 */
export function detectPaymentMethod(rawResponse: any): string {
  if (!rawResponse) return 'card'

  if (rawResponse.payment_method === 'test_card') return 'test_card'
  if (rawResponse.payment_method === 'gift_card_only') return 'gift_card'
  if (rawResponse.bit_hf_initiated || rawResponse.bit_api_initiated || rawResponse.bit_callback_status) return 'bit'
  if (rawResponse.hosted_fields_initiated) return 'card'

  return 'card'
}
