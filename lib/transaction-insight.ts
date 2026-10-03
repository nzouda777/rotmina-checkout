/**
 * Turns a raw payment_sessions row into a human-readable explanation for the
 * admin panel: what happened, why, and what the merchant can do about it.
 *
 * Pure function — safe to run on the server (admin API) or in the browser.
 * Reads the gateway codes stored in raw_response (Tranzila callback params,
 * 3DS-complete response, SDK result) rather than trusting error_message alone,
 * since error_message comes from several code paths with inconsistent wording.
 */

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

const ASK_OTHER_CARD: L = {
  en: 'Nothing to fix on our side. The customer should contact their bank or pay with another card or Bit.',
  he: 'אין מה לתקן מצדנו. על הלקוח לפנות לבנק או לשלם בכרטיס אחר או ב-Bit.',
}
const ASK_RECHECK_DETAILS: L = {
  en: 'The customer should re-enter their card details carefully and try again.',
  he: 'על הלקוח להזין מחדש את פרטי הכרטיס בקפידה ולנסות שוב.',
}
const CHECK_TERMINAL: L = {
  en: 'Configuration issue on our side: check the Tranzila terminal settings (currencies, test/live mode, installments) or contact Tranzila support.',
  he: 'בעיית הגדרות מצדנו: יש לבדוק את הגדרות המסוף בטרנזילה (מטבעות, מצב בדיקה/אמת, תשלומים) או לפנות לתמיכת טרנזילה.',
}
const RETRY_LATER: L = {
  en: 'Temporary problem at the bank or gateway. The customer can simply try again in a few minutes.',
  he: 'תקלה זמנית בבנק או בשער התשלום. הלקוח יכול פשוט לנסות שוב בעוד מספר דקות.',
}

function code(category: InsightCategory, headline: L, explanation: L, action: L): CodeInfo {
  return { category, headline, explanation, action }
}

const TRANZILA_CODES: Record<string, CodeInfo> = {
  '001': code('bank_decline',
    { en: 'Card blocked', he: 'כרטיס חסום' },
    { en: 'The issuing bank reports this card as blocked.', he: 'הבנק המנפיק מדווח שהכרטיס חסום.' },
    ASK_OTHER_CARD),
  '002': code('bank_decline',
    { en: 'Card reported stolen', he: 'כרטיס מדווח כגנוב' },
    { en: 'The issuing bank reports this card as stolen.', he: 'הבנק המנפיק מדווח שהכרטיס גנוב.' },
    { en: 'Do not retry with this card. Be cautious if the same customer keeps trying different cards.', he: 'אין לנסות שוב עם כרטיס זה. יש לנהוג בזהירות אם אותו לקוח מנסה כרטיסים שונים.' }),
  '003': code('bank_decline',
    { en: 'Bank asks to call the card company', he: 'הבנק מבקש לפנות לחברת האשראי' },
    { en: 'The card company needs the cardholder to call them before approving.', he: 'חברת האשראי דורשת שבעל הכרטיס יתקשר אליה לפני אישור.' },
    ASK_OTHER_CARD),
  '004': code('bank_decline',
    { en: 'Refused by the bank', he: 'סירוב של הבנק' },
    { en: 'The issuing bank refused the charge without giving a specific reason.', he: 'הבנק המנפיק סירב לחיוב ללא סיבה מפורטת.' },
    ASK_OTHER_CARD),
  '005': code('bank_decline',
    { en: 'Refused by the bank (do not honor)', he: 'סירוב של הבנק (Do not honor)' },
    { en: 'The issuing bank refused the charge (generic "do not honor" decline).', he: 'הבנק המנפיק סירב לחיוב (סירוב כללי).' },
    ASK_OTHER_CARD),
  '006': code('card_details',
    { en: 'Wrong CVV or ID number', he: 'CVV או תעודת זהות שגויים' },
    { en: 'The 3-digit security code or the ID number does not match the card.', he: 'קוד האבטחה (3 ספרות) או מספר תעודת הזהות אינם תואמים לכרטיס.' },
    ASK_RECHECK_DETAILS),
  '007': code('bank_decline',
    { en: 'Bank asks to call the card company', he: 'הבנק מבקש לפנות לחברת האשראי' },
    { en: 'The card company needs the cardholder to call them before approving.', he: 'חברת האשראי דורשת שבעל הכרטיס יתקשר אליה לפני אישור.' },
    ASK_OTHER_CARD),
  '009': code('bank_decline',
    { en: 'Transaction not permitted', he: 'העסקה אינה מורשית' },
    { en: 'This card is not allowed to make this type of transaction.', he: 'הכרטיס אינו מורשה לבצע עסקה מסוג זה.' },
    ASK_OTHER_CARD),
  '010': code('bank_decline',
    { en: 'Not approved', he: 'לא אושר' },
    { en: 'The transaction was not approved by the card company.', he: 'העסקה לא אושרה על ידי חברת האשראי.' },
    ASK_OTHER_CARD),
  '011': code('configuration',
    { en: 'Invalid amount', he: 'סכום לא תקין' },
    { en: 'The gateway rejected the amount sent by the checkout.', he: 'שער התשלום דחה את הסכום שנשלח מהצ\'קאאוט.' },
    CHECK_TERMINAL),
  '012': code('card_details',
    { en: 'Invalid card number', he: 'מספר כרטיס לא תקין' },
    { en: 'The card number entered is not valid.', he: 'מספר הכרטיס שהוזן אינו תקין.' },
    ASK_RECHECK_DETAILS),
  '013': code('configuration',
    { en: 'Invalid amount', he: 'סכום לא תקין' },
    { en: 'The gateway rejected the amount sent by the checkout.', he: 'שער התשלום דחה את הסכום שנשלח מהצ\'קאאוט.' },
    CHECK_TERMINAL),
  '014': code('card_details',
    { en: 'Invalid card number', he: 'מספר כרטיס לא תקין' },
    { en: 'The card number is not valid for this terminal.', he: 'מספר הכרטיס אינו תקף עבור מסוף זה.' },
    ASK_RECHECK_DETAILS),
  '015': code('configuration',
    { en: 'Terminal not found', he: 'המסוף לא נמצא' },
    { en: 'Tranzila does not recognise the terminal used by the checkout.', he: 'טרנזילה אינה מזהה את המסוף שבו משתמש הצ\'קאאוט.' },
    CHECK_TERMINAL),
  '017': code('card_details',
    { en: 'Card expired', he: 'פג תוקף הכרטיס' },
    { en: 'The card is past its expiry date, or the expiry date was entered incorrectly.', he: 'תוקף הכרטיס פג, או שתאריך התוקף הוזן בטעות.' },
    ASK_RECHECK_DETAILS),
  '033': code('configuration',
    { en: 'Currency or test/live mismatch', he: 'אי התאמה במטבע או במצב בדיקה/אמת' },
    { en: 'The terminal does not accept this currency, or a test card was used on a live terminal (or the opposite).', he: 'המסוף אינו מקבל מטבע זה, או שנעשה שימוש בכרטיס בדיקה במסוף אמיתי (או להפך).' },
    CHECK_TERMINAL),
  '036': code('card_details',
    { en: 'Card expired', he: 'פג תוקף הכרטיס' },
    { en: 'The card is past its expiry date.', he: 'תוקף הכרטיס פג.' },
    ASK_RECHECK_DETAILS),
  '039': code('card_details',
    { en: 'Invalid card number', he: 'מספר כרטיס לא תקין' },
    { en: 'The card number failed the validity check (typo likely).', he: 'מספר הכרטיס נכשל בבדיקת התקינות (כנראה טעות הקלדה).' },
    ASK_RECHECK_DETAILS),
  '041': code('bank_decline',
    { en: 'Card reported lost', he: 'כרטיס מדווח כאבוד' },
    { en: 'The issuing bank reports this card as lost.', he: 'הבנק המנפיק מדווח שהכרטיס אבד.' },
    ASK_OTHER_CARD),
  '043': code('bank_decline',
    { en: 'Card reported stolen', he: 'כרטיס מדווח כגנוב' },
    { en: 'The issuing bank reports this card as stolen.', he: 'הבנק המנפיק מדווח שהכרטיס גנוב.' },
    { en: 'Do not retry with this card. Be cautious if the same customer keeps trying different cards.', he: 'אין לנסות שוב עם כרטיס זה. יש לנהוג בזהירות אם אותו לקוח מנסה כרטיסים שונים.' }),
  '051': code('bank_decline',
    { en: 'Insufficient funds', he: 'אין מספיק יתרה / מסגרת' },
    { en: 'The card does not have enough available credit for this amount.', he: 'אין בכרטיס מסגרת פנויה מספקת לסכום זה.' },
    { en: 'The customer can use another card, choose installments, or pay with Bit.', he: 'הלקוח יכול להשתמש בכרטיס אחר, לבחור בתשלומים או לשלם ב-Bit.' }),
  '054': code('card_details',
    { en: 'Card expired', he: 'פג תוקף הכרטיס' },
    { en: 'The card is past its expiry date, or the expiry date was entered incorrectly.', he: 'תוקף הכרטיס פג, או שתאריך התוקף הוזן בטעות.' },
    ASK_RECHECK_DETAILS),
  '055': code('card_details',
    { en: 'Incorrect PIN', he: 'קוד PIN שגוי' },
    { en: 'The card company rejected the PIN.', he: 'חברת האשראי דחתה את קוד ה-PIN.' },
    ASK_RECHECK_DETAILS),
  '057': code('bank_decline',
    { en: 'Not allowed for this cardholder', he: 'לא מורשה לבעל הכרטיס' },
    { en: 'The bank does not allow this cardholder to make this kind of purchase (often online or foreign purchases).', he: 'הבנק אינו מאפשר לבעל הכרטיס לבצע רכישה מסוג זה (לרוב רכישה אונליין או בחו"ל).' },
    ASK_OTHER_CARD),
  '058': code('configuration',
    { en: 'Not allowed on this terminal', he: 'לא מורשה במסוף זה' },
    { en: 'Our terminal is not allowed to accept this card type or transaction type (e.g. installments, Amex, Diners).', he: 'המסוף שלנו אינו מורשה לקבל סוג כרטיס או עסקה זה (למשל תשלומים, אמריקן אקספרס, דיינרס).' },
    CHECK_TERMINAL),
  '061': code('bank_decline',
    { en: 'Card limit exceeded', he: 'חריגה ממגבלת הכרטיס' },
    { en: 'The amount exceeds the card\'s spending limit.', he: 'הסכום חורג ממגבלת ההוצאה של הכרטיס.' },
    ASK_OTHER_CARD),
  '062': code('bank_decline',
    { en: 'Restricted card', he: 'כרטיס מוגבל' },
    { en: 'The card has restrictions set by the bank.', he: 'הבנק הגדיר הגבלות על הכרטיס.' },
    ASK_OTHER_CARD),
  '065': code('bank_decline',
    { en: 'Too many attempts on this card', he: 'יותר מדי ניסיונות בכרטיס זה' },
    { en: 'The card exceeded its allowed number of transactions.', he: 'הכרטיס חרג ממספר העסקאות המותר.' },
    ASK_OTHER_CARD),
  '091': code('technical',
    { en: 'Bank unavailable', he: 'הבנק אינו זמין' },
    { en: 'The card issuer could not be reached.', he: 'לא ניתן היה ליצור קשר עם מנפיק הכרטיס.' },
    RETRY_LATER),
  '096': code('technical',
    { en: 'Payment system error', he: 'שגיאת מערכת תשלומים' },
    { en: 'A system error occurred at the card processor.', he: 'אירעה שגיאת מערכת אצל מעבד האשראי.' },
    RETRY_LATER),
  '900': code('authentication',
    { en: '3D Secure verification failed', he: 'אימות 3D Secure נכשל' },
    { en: 'The transaction was cancelled because the bank\'s identity check (3D Secure) did not succeed.', he: 'העסקה בוטלה כי אימות הזהות של הבנק (3D Secure) לא הצליח.' },
    { en: 'The customer should retry and complete the bank verification (SMS code / banking app), or pay with Bit.', he: 'על הלקוח לנסות שוב ולהשלים את אימות הבנק (קוד SMS / אפליקציית הבנק), או לשלם ב-Bit.' }),
  '930': code('authentication',
    { en: '3D Secure not completed', he: 'אימות 3D Secure לא הושלם' },
    { en: 'The customer started the bank verification but did not finish it.', he: 'הלקוח התחיל את אימות הבנק אך לא סיים אותו.' },
    { en: 'No money was taken. The customer can retry and complete the verification.', he: 'לא בוצע חיוב. הלקוח יכול לנסות שוב ולהשלים את האימות.' }),
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
  { re: /insufficient/i, code: '051', info: TRANZILA_CODES['051'] },
  { re: /expired/i, code: '054', info: TRANZILA_CODES['054'] },
  { re: /stolen/i, code: '043', info: TRANZILA_CODES['043'] },
  { re: /lost card/i, code: '041', info: TRANZILA_CODES['041'] },
  { re: /cvv|id (verification|error)/i, code: '006', info: TRANZILA_CODES['006'] },
  { re: /invalid card number/i, code: '012', info: TRANZILA_CODES['012'] },
  { re: /blocked/i, code: '001', info: TRANZILA_CODES['001'] },
  { re: /currency|test\/live/i, code: '033', info: TRANZILA_CODES['033'] },
  { re: /terminal/i, code: '058', info: TRANZILA_CODES['058'] },
  { re: /3d ?s|authentication/i, code: '930', info: TRANZILA_CODES['930'] },
  { re: /do not honor|refus|declined by (bank|processor)|not approved/i, code: '004', info: TRANZILA_CODES['004'] },
]

const GENERIC_DECLINE: CodeInfo = code('bank_decline',
  { en: 'Payment declined', he: 'התשלום נדחה' },
  { en: 'The payment was declined, but the gateway did not give a specific reason.', he: 'התשלום נדחה, אך שער התשלום לא ציין סיבה מפורטת.' },
  { en: 'Look up the transaction in the Tranzila portal for the full reason. The customer can try another card or Bit.', he: 'יש לחפש את העסקה בפורטל טרנזילה לסיבה המלאה. הלקוח יכול לנסות כרטיס אחר או Bit.' })

const API_ERROR: CodeInfo = code('configuration',
  { en: 'Gateway rejected the request', he: 'שער התשלום דחה את הבקשה' },
  { en: 'Tranzila rejected the request before contacting the bank (invalid parameters or terminal settings).', he: 'טרנזילה דחתה את הבקשה לפני הפנייה לבנק (פרמטרים או הגדרות מסוף לא תקינים).' },
  CHECK_TERMINAL)

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

function explainFailure(
  session: InsightSessionInput, raw: Record<string, any>, method: PaymentMethodKind, facts: InsightFact[],
  outcome: InsightOutcome,
): TransactionInsight | null {
  const lastFailure = raw._last_failure as { code?: string; message?: string; source?: string } | undefined
  const source: 'gateway' | 'checkout' = !session.error_message && lastFailure?.source === 'checkout'
    ? 'checkout'
    : 'gateway'

  const gwCode = extractGatewayCode(raw)
  if (gwCode && TRANZILA_CODES[gwCode]) return fromInfo(TRANZILA_CODES[gwCode], outcome, method, facts, gwCode, source)

  // Tranzila API-level rejection (error_code != 0) — the bank was never contacted
  if (raw.error_code != null && Number(raw.error_code) !== 0 && Number(raw.error_code) !== 930) {
    const detail = typeof raw.message === 'string' ? raw.message : undefined
    const insight = fromInfo(API_ERROR, outcome, method, facts, String(raw.error_code), 'gateway')
    if (detail) {
      insight.explanation = {
        en: `${API_ERROR.explanation.en} Gateway message: "${detail}".`,
        he: `${API_ERROR.explanation.he} הודעת השער: "${detail}".`,
      }
    }
    return insight
  }
  if (Number(raw.error_code) === 930) return fromInfo(TRANZILA_CODES['930'], outcome, method, facts, '930', source)

  const message = session.error_message || lastFailure?.message || ''
  if (message) {
    const match = MESSAGE_PATTERNS.find((p) => p.re.test(message))
    const info = match?.info || GENERIC_DECLINE
    const insight = fromInfo(info, outcome, method, facts, gwCode || match?.code, source)
    if (!match) {
      insight.explanation = {
        en: `${GENERIC_DECLINE.explanation.en} Message received: "${message}".`,
        he: `${GENERIC_DECLINE.explanation.he} הודעה שהתקבלה: "${message}".`,
      }
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
      ? fromInfo(TRANZILA_CODES['930'], 'abandoned', method, facts)
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
