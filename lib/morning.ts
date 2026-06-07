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

const MORNING_API_KEY = process.env.MORNING_API_KEY || ''
const MORNING_API_SECRET = process.env.MORNING_API_SECRET || ''
const MORNING_SANDBOX = process.env.MORNING_SANDBOX === 'true'

const BASE_URL = MORNING_SANDBOX
  ? 'https://sandbox.d.greeninvoice.co.il/api/v1'
  : 'https://api.greeninvoice.co.il/api/v1'

// ─── Document types ─────────────────────────────────────────────────────────────
// 305 = Tax Invoice
// 320 = Tax Invoice + Receipt (חשבונית מס/קבלה)
// 400 = Receipt (קבלה)
const RECEIPT_DOC_TYPE = 400

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

  if (!MORNING_API_KEY || !MORNING_API_SECRET) {
    throw new Error('[MORNING] Missing MORNING_API_KEY or MORNING_API_SECRET environment variables')
  }

  console.log(`[MORNING] Requesting new access token from ${BASE_URL}/account/token`)

  const response = await fetch(`${BASE_URL}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: MORNING_API_KEY,
      secret: MORNING_API_SECRET,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`[MORNING] Authentication failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  cachedToken = data.token
  // JWT tokens from Morning are typically valid for 1 hour
  tokenExpiresAt = Date.now() + 55 * 60 * 1000 // Refresh 5 min early

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

  if (!MORNING_API_KEY || !MORNING_API_SECRET) {
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

    // Build line items (income array)
    const income = items && items.length > 0
      ? items.map(item => ({
          catalogNum: '',
          description: item.description,
          quantity: item.quantity,
          price: item.price,
          currency: getCurrencyCode(currency),
          vatType: 0, // Default VAT included
        }))
      : [
          {
            catalogNum: '',
            description: description || 'Purchase',
            quantity: 1,
            price: amount,
            currency: getCurrencyCode(currency),
            vatType: 0,
          },
        ]

    // Build the document payload
    const documentPayload = {
      type: RECEIPT_DOC_TYPE,
      date: payDate,
      dueDate: payDate,
      lang,
      currency: getCurrencyCode(currency),
      vatType: 0, // VAT included in price
      amount,
      // Client (recipient) info
      client: {
        name: customerName,
        emails: [customerEmail],
        add: true, // Auto-create client if not found
      },
      // Trigger email sending
      email: {
        to: [
          {
            email: customerEmail,
          }
        ],
        lang: lang,
      },
      // Line items
      income,
      // Payment details (required for type 400 Receipt)
      payment: [
        {
          type: morningPaymentType,
          price: amount,
          currency: getCurrencyCode(currency),
          date: payDate,
        },
      ],
      // Remarks
      remarks: lang === 'he' ?  '!תתחדשי' : 'Thank you !',
      // Footer
      footer: '',
    }

    console.log(`[MORNING] Creating receipt for ${customerEmail} | amount: ${amount} ${currency} | type: ${morningPaymentType}`)

    const response = await fetch(`${BASE_URL}/documents`, {
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
    
    let documentUrl = result.url || result.shareUrl || (documentId ? `${BASE_URL}/documents/${documentId}` : undefined)
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

// ─── Helpers ────────────────────────────────────────────────────────────────────

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
