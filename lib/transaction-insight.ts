/**
 * Turns a raw payment_sessions row into a human-readable explanation for the
 * admin panel: what happened, why, and what the merchant can do about it.
 *
 * Pure function — safe to run on the server (admin API) or in the browser.
 * Reads the gateway codes stored in raw_response (Tranzila callback params,
 * 3DS-complete response, SDK result) rather than trusting error_message alone,
 * since error_message comes from several code paths with inconsistent wording.
 */

import { gatewayFields, gatewayMessage, mismatchSummary, type GatewayField } from './tranzila-response'
import { describeTranzilaCode, normalizeTranzilaCode } from './tranzila-codes'

type L = { en: string; he: string }

export type InsightOutcome = 'success' | 'failed' | 'attention' | 'abandoned' | 'in_progress'

export type InsightCategory =
  | 'bank_decline'      // issuer refused (funds, blocked, do-not-honor…)
  | 'card_details'      // wrong number / CVV / expiry entered by the customer
  | 'authentication'    // 3DS not completed / failed
  | 'cancelled'         // customer cancelled (Bit app, 3DS modal)
  | 'configuration'     // terminal / currency / test-mode problem on our side
  | 'technical'         // gateway or server error
  | 'abandoned'         // customer left before paying
  | 'order_missing'     // money taken but no Shopify order

export type PaymentMethodKind = 'card' | 'bit' | 'gift_card' | 'test_card'

export interface InsightFact {
  label: L
  value: string
  mono?: boolean
}

export interface TransactionInsight {
  outcome: InsightOutcome
  method: PaymentMethodKind
  category?: InsightCategory
  code?: string
  /** Where the failure reason came from: the gateway itself, or the customer's browser. */
  source?: 'gateway' | 'checkout'
  headline: L
  explanation?: L
  action?: L
  facts: InsightFact[]
  /** Tranzila's documented meaning of `code`, verbatim. */
  official?: string
  /** What Tranzila actually returned (failed transactions only). */
  gateway?: { message?: string; fields: GatewayField[] }
}

export interface InsightSessionInput {
  status: string
  amount?: number | null
  currency?: string | null
  order_id?: string | null
  tranzila_transaction_id?: string | null
  error_message?: string | null
  raw_response?: Record<string, any> | null
  created_at: string
  updated_at?: string | null
}

// ── Gateway codes ─────────────────────────────────────────────────────────────

interface CodeInfo {
  category: InsightCategory
  headline: L
  explanation: L
  action: L
}

function code(category: InsightCategory, headline: L, explanation: L, action: L): CodeInfo {
  return { category, headline, explanation, action }
}

/** Official Tranzila code → CodeInfo (see lib/tranzila-codes.ts). */
function tz(c: string): CodeInfo {
  const info = describeTranzilaCode(c)!
  return { category: info.category, headline: info.headline, explanation: info.explanation, action: info.action }
}

// Free-text messages (error_message / client-reported reasons) → category.
// Used when no gateway code is available.
const MESSAGE_PATTERNS: { re: RegExp; info: CodeInfo; code?: string }[] = [
  { re: /bit payment (failure|failed)/i, info: code('bank_decline',
    { en: 'Bit payment declined', he: 'תשלום Bit נדחה' },
    { en: 'The payment was declined in the Bit app (rejected by the customer, by the bank, or Bit limit reached).', he: 'התשלום נדחה באפליקציית Bit (נדחה על ידי הלקוח, הבנק, או שהגיע למגבלת Bit).' },
    { en: 'The customer can retry Bit or pay by card.', he: 'הלקוח יכול לנסות שוב ב-Bit או לשלם בכרטיס.' }) },
  { re: /bit payment (cancel|was cancel)/i, info: code('cancelled',
    { en: 'Bit payment cancelled', he: 'תשלום Bit בוטל' },
    { en: 'The customer cancelled the payment in the Bit app.', he: 'הלקוח ביטל את התשלום באפליקציית Bit.' },
    { en: 'No money was taken. No action needed unless the customer contacts you.', he: 'לא בוצע חיוב. אין צורך בפעולה אלא אם הלקוח פונה.' }) },
  { re: /bit .*(initiali[sz]ation|no redirect)/i, info: code('configuration',
    { en: 'Bit could not start', he: 'לא ניתן היה להפעיל את Bit' },
    { en: 'Tranzila did not return a Bit payment link, so the customer never reached the Bit app.', he: 'טרנזילה לא החזירה קישור לתשלום Bit, ולכן הלקוח לא הגיע לאפליקציית Bit.' },
    { en: 'Check that Bit is enabled on the Tranzila terminal.', he: 'יש לוודא ש-Bit מופעל במסוף טרנזילה.' }) },
  { re: /gift card payment/i, info: code('technical',
    { en: 'Gift card could not be charged', he: 'לא ניתן היה לחייב את כרטיס המתנה' },
    { en: 'The gift card balance could not be debited (balance changed or database error).', he: 'לא ניתן היה לחייב את יתרת כרטיס המתנה (היתרה השתנתה או שגיאת מסד נתונים).' },
    { en: 'Check the gift card balance in the Gift Cards page; the customer can retry.', he: 'יש לבדוק את יתרת כרטיס המתנה בעמוד כרטיסי המתנה; הלקוח יכול לנסות שוב.' }) },
  { re: /3ds_cancel|cancelled.*(3ds|verification)|user cancel/i, code: undefined, info: code('cancelled',
    { en: 'Customer closed the bank verification', he: 'הלקוח סגר את חלון אימות הבנק' },
    { en: 'The customer closed the 3D Secure window before finishing it.', he: 'הלקוח סגר את חלון ה-3D Secure לפני שסיים.' },
    { en: 'No money was taken. The customer can retry.', he: 'לא בוצע חיוב. הלקוח יכול לנסות שוב.' }) },
  { re: /\b999\b/, code: '999', info: code('technical',
    { en: 'No readable answer from Tranzila', he: 'לא התקבלה תשובה קריאה מטרנזילה' },
    { en: '999 is not a Tranzila code: our checkout records it when the payment window closed or returned nothing it could interpret. The real result is only in the Tranzila portal.', he: '999 אינו קוד של טרנזילה: הצ\'קאאוט שלנו רושם אותו כאשר חלון התשלום נסגר או לא החזיר תשובה שניתן לפענח. התוצאה האמיתית נמצאת רק בפורטל טרנזילה.' },
    { en: 'Check this transaction in the Tranzila portal (by date and amount). If it was charged, create the order manually in Shopify.', he: 'יש לבדוק את העסקה בפורטל טרנזילה (לפי תאריך וסכום). אם בוצע חיוב, יש ליצור את ההזמנה ידנית בשופיפיי.' }) },
  { re: /json|schema|mismatch_info/i, code: '20003', info: tz('20003') },
  { re: /credit_card_number|card_number_invalid|invalid card number|wrong credit card|מספר כרטיס/i, code: '447', info: tz('447') },
  { re: /expir|תוקף/i, code: '015', info: tz('015') },
  { re: /cvv|קוד אבטחה|תעודת זהות|id (verification|error)/i, code: '006', info: tz('006') },
  { re: /insufficient|יתרה|מסגרת/i, info: code('bank_decline',
    { en: 'Insufficient credit on the card', he: 'אין מסגרת מספקת בכרטיס' },
    { en: 'The card does not have enough available credit for this amount.', he: 'אין בכרטיס מסגרת פנויה מספקת לסכום זה.' },
    { en: 'The customer can use another card, choose installments, or pay with Bit.', he: 'הלקוח יכול להשתמש בכרטיס אחר, לבחור בתשלומים או לשלם ב-Bit.' }) },
  { re: /stolen/i, code: '002', info: tz('002') },
  { re: /blocked|lost card/i, code: '001', info: tz('001') },
  { re: /currency/i, code: '016', info: tz('016') },
  { re: /terminal/i, code: '417', info: tz('417') },
  { re: /3d ?s|authentication/i, code: '930', info: tz('930') },
  { re: /do not honor|refus|declined by (bank|processor)|not approved/i, code: '004', info: tz('004') },
]

const GENERIC_DECLINE: CodeInfo = code('bank_decline',
  { en: 'Payment declined', he: 'התשלום נדחה' },
  { en: 'The payment was declined, but the gateway did not give a specific reason.', he: 'התשלום נדחה, אך שער התשלום לא ציין סיבה מפורטת.' },
  { en: 'Look up the transaction in the Tranzila portal for the full reason. The customer can try another card or Bit.', he: 'יש לחפש את העסקה בפורטל טרנזילה לסיבה המלאה. הלקוח יכול לנסות כרטיס אחר או Bit.' })

const API_ERROR: CodeInfo = code('configuration',
  { en: 'Gateway rejected the request', he: 'שער התשלום דחה את הבקשה' },
  { en: 'Tranzila rejected the request before contacting the bank (invalid parameters or terminal settings).', he: 'טרנזילה דחתה את הבקשה לפני הפנייה לבנק (פרמטרים או הגדרות מסוף לא תקינים).' },
  { en: 'Send the code and the Tranzila response below to Tranzila support or to the developer.', he: 'יש להעביר את הקוד ואת תגובת טרנזילה למטה לתמיכת טרנזילה או למפתח.' })

// ── Helpers ───────────────────────────────────────────────────────────────────

function nonApproved(c: unknown): string | undefined {
  if (c == null || c === '') return undefined
  const s = String(c).padStart(3, '0')
  return s === '000' ? undefined : s
}

/** Pull the most authoritative gateway code out of whatever shape raw_response has. */
function extractGatewayCode(raw: Record<string, any>): string | undefined {
  return (
    nonApproved(raw.transaction_result?.processor_response_code) ||
    nonApproved(raw.transaction_response?.processor_response_code) ||
    nonApproved(raw.processor_response_code) ||
    nonApproved(raw.Response) ||
    nonApproved(raw._last_failure?.code)
  )
}

function detectMethod(raw: Record<string, any>, txnId?: string | null): PaymentMethodKind {
  if (raw.payment_method === 'test_card' || txnId?.startsWith('TEST-')) return 'test_card'
  if (raw.payment_method === 'gift_card_only' || txnId?.startsWith('GC-')) return 'gift_card'
  if (raw.bit_hf_initiated || raw.bit_api_initiated || raw.bit_callback_status || raw._last_failure?.method === 'bit') return 'bit'
  return 'card'
}

function cardFacts(raw: Record<string, any>): InsightFact[] {
  const tr = raw.transaction_result || raw.transaction_response || {}
  const facts: InsightFact[] = []

  const brand = tr.card_type_name || tr.card_brand || raw.cardtype_name || raw.cardtype
  const last4 = tr.last_4 || tr.credit_card_last_4_digits || tr.card_last_4 || raw.last4 ||
    (typeof raw.ccno === 'string' && raw.ccno.length >= 4 ? raw.ccno.slice(-4) : undefined)
  if (last4) {
    facts.push({ label: { en: 'Card', he: 'כרטיס' }, value: `${brand ? `${brand} ` : ''}•••• ${last4}`, mono: true })
  }

  const expM = tr.expiry_month || raw.expmonth
  const expY = tr.expiry_year || raw.expyear
  if (expM && expY) {
    facts.push({ label: { en: 'Expiry', he: 'תוקף' }, value: `${String(expM).padStart(2, '0')}/${String(expY).slice(-2)}`, mono: true })
  }

  const auth = tr.auth_number || raw.ConfirmationCode
  if (auth) facts.push({ label: { en: 'Bank approval no.', he: 'מספר אישור בנק' }, value: String(auth), mono: true })

  const plan = Number(tr.payment_plan || tr.installments || tr.number_of_payments || 0)
  if (plan > 1) facts.push({ label: { en: 'Installments', he: 'תשלומים' }, value: String(plan) })

  return facts
}

function minutesSince(iso?: string | null): number {
  if (!iso) return 0
  return (Date.now() - new Date(iso).getTime()) / 60000
}

function fromInfo(
  info: CodeInfo, outcome: InsightOutcome, method: PaymentMethodKind,
  facts: InsightFact[], codeStr?: string, source?: 'gateway' | 'checkout',
): TransactionInsight {
  return {
    outcome, method, facts, source,
    category: info.category,
    code: codeStr,
    headline: info.headline,
    explanation: info.explanation,
    action: info.action,
  }
}

/** Attach Tranzila's official wording for the code, shown under the headline. */
function withOfficial(insight: TransactionInsight, codeStr: string): TransactionInsight {
  const official = describeTranzilaCode(codeStr)?.official
  if (official) insight.official = official
  return insight
}

function explainFailure(
  session: InsightSessionInput, raw: Record<string, any>, method: PaymentMethodKind, facts: InsightFact[],
  outcome: InsightOutcome,
): TransactionInsight | null {
  const lastFailure = raw._last_failure as
    { code?: string; message?: string; source?: string; gateway_response?: Record<string, any> } | undefined

  // The Tranzila response to read: the SDK result the browser reported, or
  // the response stored by the server routes (callback params / 3DS-complete body).
  const { _last_failure, _gift_card, _coupon, _generated_gift_cards, ...serverResponse } = raw
  const tzResponse = lastFailure?.gateway_response || serverResponse
  const fields = gatewayFields(tzResponse)
  const tzMessage = gatewayMessage(tzResponse)

  const insight = interpretFailure(session, raw, tzResponse, tzMessage, lastFailure, method, facts, outcome)
  if (insight && (fields.length || tzMessage)) insight.gateway = { message: tzMessage, fields }
  return insight
}

function interpretFailure(
  session: InsightSessionInput, raw: Record<string, any>, resp: Record<string, any>, tzMessage: string | undefined,
  lastFailure: { code?: string; message?: string; source?: string } | undefined,
  method: PaymentMethodKind, facts: InsightFact[], outcome: InsightOutcome,
): TransactionInsight | null {
  const source: 'gateway' | 'checkout' = !session.error_message && lastFailure?.source === 'checkout'
    ? 'checkout'
    : 'gateway'

  const gwCode = extractGatewayCode(raw) || extractGatewayCode(resp)
  if (gwCode && describeTranzilaCode(gwCode)) return withOfficial(fromInfo(tz(gwCode), outcome, method, facts, gwCode, source), gwCode)

  // Tranzila API-level rejection (error_code != 0) — the bank was never contacted
  const apiCode = resp.error_code ?? raw.error_code
  // Application error codes (900, 20003…) — the bank may never have been contacted
  const apiCodeStr = normalizeTranzilaCode(apiCode)
  if (apiCodeStr && apiCodeStr !== '000' && describeTranzilaCode(apiCodeStr)) {
    const insight = withOfficial(fromInfo(tz(apiCodeStr), outcome, method, facts, apiCodeStr, 'gateway'), apiCodeStr)
    const fieldsRejected = mismatchSummary(resp.mismatch_info ?? raw.mismatch_info)
    if (fieldsRejected) {
      insight.explanation = {
        en: `${insight.explanation!.en} Rejected field(s): ${fieldsRejected}.`,
        he: `${insight.explanation!.he} שדות שנדחו: ${fieldsRejected}.`,
      }
    }
    return insight
  }

  if (apiCode != null && Number(apiCode) !== 0) {
    const insight = fromInfo(API_ERROR, outcome, method, facts, String(apiCode), 'gateway')
    if (tzMessage) insight.headline = { en: tzMessage, he: tzMessage }
    return insight
  }

  // Everything we know in words: our stored message, Tranzila's message, Tranzila's message codes
  const tzCodes = [resp.error, ...(Array.isArray(resp.messages) ? resp.messages.map((m: any) => m?.code) : [])]
    .filter((x) => typeof x === 'string')
  const text = [session.error_message, lastFailure?.message, tzMessage, ...tzCodes].filter(Boolean).join(' | ')
  const match = text ? MESSAGE_PATTERNS.find((p) => p.re.test(text)) : undefined
  if (match) {
    const insight = fromInfo(match.info, outcome, method, facts, gwCode || match.code, source)
    if (match.code === '20003') {
      insight.official = describeTranzilaCode('20003')?.official
      insight.action = {
        en: 'Developer issue. Tranzila\'s detailed answer (which field was rejected) was not saved for this transaction. Failures recorded from now on include it under "mismatch_info".',
        he: 'בעיה לטיפול המפתח. התשובה המפורטת של טרנזילה (איזה שדה נדחה) לא נשמרה עבור עסקה זו. כשלים שיירשמו מעתה יכללו אותה תחת "mismatch_info".',
      }
    }
    return insight
  }

  if (tzMessage || text) {
    // Unknown reason: show Tranzila's own words as the headline
    const insight = fromInfo(GENERIC_DECLINE, outcome, method, facts, gwCode, source)
    const said = tzMessage || text
    insight.headline = { en: said, he: said }
    insight.explanation = tzMessage
      ? {
          en: 'The payment was declined. The reason above is the exact message returned by Tranzila.',
          he: 'התשלום נדחה. הסיבה למעלה היא ההודעה המדויקת שהחזירה טרנזילה.',
        }
      : {
          en: 'The payment was declined. The reason above is what our checkout recorded; Tranzila\'s detailed answer was not saved.',
          he: 'התשלום נדחה. הסיבה למעלה היא מה שרשם הצ\'קאאוט שלנו; התשובה המפורטת של טרנזילה לא נשמרה.',
        }
    return insight
  }

  if (gwCode) {
    const insight = fromInfo(GENERIC_DECLINE, outcome, method, facts, gwCode, 'gateway')
    insight.headline = { en: `Declined (code ${gwCode})`, he: `נדחה (קוד ${gwCode})` }
    return insight
  }
  return null
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function explainTransaction(session: InsightSessionInput): TransactionInsight {
  const raw = (session.raw_response || {}) as Record<string, any>
  const method = detectMethod(raw, session.tranzila_transaction_id)
  const facts: InsightFact[] = method === 'card' ? cardFacts(raw) : []

  if (session.tranzila_transaction_id && !facts.some((f) => f.value === session.tranzila_transaction_id)) {
    facts.unshift({ label: { en: 'Transaction ref.', he: 'אסמכתא' }, value: session.tranzila_transaction_id, mono: true })
  }

  // ── Paid ──
  if (session.status === 'paid') {
    if (method === 'test_card') {
      return {
        outcome: 'attention', method, facts, category: 'configuration',
        headline: { en: 'Test transaction', he: 'עסקת בדיקה' },
        explanation: { en: 'Paid with the internal test card. No money was collected.', he: 'שולם בכרטיס הבדיקה הפנימי. לא נגבה כסף.' },
        action: { en: 'If a Shopify order was created, cancel it so it is not shipped.', he: 'אם נוצרה הזמנה בשופיפיי, יש לבטל אותה כדי שלא תישלח.' },
      }
    }
    if (!session.order_id) {
      return {
        outcome: 'attention', method, facts, category: 'order_missing',
        headline: { en: 'Paid — Shopify order missing', he: 'שולם — חסרה הזמנה בשופיפיי' },
        explanation: {
          en: 'The customer was charged, but the Shopify order could not be created (Shopify error or timeout).',
          he: 'הלקוח חויב, אך לא ניתן היה ליצור את ההזמנה בשופיפיי (שגיאת שופיפיי או פסק זמן).',
        },
        action: {
          en: 'Create the order manually in Shopify using the items and address below, so it gets shipped.',
          he: 'יש ליצור את ההזמנה ידנית בשופיפיי לפי הפריטים והכתובת למטה, כדי שתישלח.',
        },
      }
    }
    const via: Record<PaymentMethodKind, L> = {
      card: { en: 'Card payment approved by the bank', he: 'תשלום בכרטיס אושר על ידי הבנק' },
      bit: { en: 'Bit payment confirmed', he: 'תשלום Bit אושר' },
      gift_card: { en: 'Paid in full with a gift card', he: 'שולם במלואו בכרטיס מתנה' },
      test_card: { en: 'Test transaction', he: 'עסקת בדיקה' },
    }
    return {
      outcome: 'success', method, facts,
      headline: via[method],
      explanation: {
        en: 'Payment collected and the Shopify order was created.',
        he: 'התשלום נגבה וההזמנה נוצרה בשופיפיי.',
      },
    }
  }

  // ── Failed ──
  if (session.status === 'failed') {
    return explainFailure(session, raw, method, facts, 'failed') || fromInfo(GENERIC_DECLINE, 'failed', method, facts)
  }

  // ── Pending after a failed attempt (checkout resets the session so the customer can retry) ──
  if (session.status === 'pending' && (session.error_message || raw._last_failure)) {
    const insight = explainFailure(session, raw, method, facts, 'failed')
    if (insight) {
      insight.headline = {
        en: `${insight.headline.en} — not retried`,
        he: `${insight.headline.he} — ללא ניסיון נוסף`,
      }
      return insight
    }
  }

  const age = minutesSince(session.updated_at || session.created_at)

  if (session.status === 'pending_3ds') {
    return age > 15
      ? fromInfo(tz('930'), 'abandoned', method, facts)
      : { outcome: 'in_progress', method, facts, headline: { en: 'Waiting for bank verification (3DS)', he: 'ממתין לאימות בנק (3DS)' } }
  }

  if (session.status === 'pending_bit') {
    return age > 15
      ? {
          outcome: 'abandoned', method, facts, category: 'abandoned',
          headline: { en: 'Bit not confirmed', he: 'Bit לא אושר' },
          explanation: { en: 'The Bit request was sent but never confirmed in the app.', he: 'בקשת Bit נשלחה אך לא אושרה באפליקציה.' },
          action: { en: 'No money was taken. No action needed unless the customer contacts you.', he: 'לא בוצע חיוב. אין צורך בפעולה אלא אם הלקוח פונה.' },
        }
      : { outcome: 'in_progress', method, facts, headline: { en: 'Waiting for Bit approval', he: 'ממתין לאישור Bit' } }
  }

  if (session.status === 'processing') {
    return age > 10
      ? {
          outcome: 'attention', method, facts, category: 'technical',
          headline: { en: 'Stuck in processing', he: 'תקוע בעיבוד' },
          explanation: { en: 'The payment started but no result came back from the gateway.', he: 'התשלום התחיל אך לא התקבלה תשובה משער התשלום.' },
          action: {
            en: 'Check the Tranzila portal: if the charge appears there, create the order manually in Shopify.',
            he: 'יש לבדוק בפורטל טרנזילה: אם החיוב מופיע שם, יש ליצור את ההזמנה ידנית בשופיפיי.',
          },
        }
      : { outcome: 'in_progress', method, facts, headline: { en: 'Processing payment', he: 'מעבד תשלום' } }
  }

  // pending (no failure recorded) / expired
  if (session.status === 'expired' || age > 30) {
    return {
      outcome: 'abandoned', method, facts, category: 'abandoned',
      headline: { en: 'Checkout abandoned', he: 'צ\'קאאוט נזנח' },
      explanation: {
        en: 'The customer opened the checkout but never submitted a payment.',
        he: 'הלקוח פתח את הצ\'קאאוט אך לא שלח תשלום.',
      },
      action: { en: 'No money was taken. No action needed.', he: 'לא בוצע חיוב. אין צורך בפעולה.' },
    }
  }
  return { outcome: 'in_progress', method, facts, headline: { en: 'Customer is on the checkout', he: 'הלקוח בצ\'קאאוט' } }
}
