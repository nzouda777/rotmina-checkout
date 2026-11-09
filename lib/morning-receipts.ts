/**
 * Morning receipt bookkeeping per payment session.
 *
 * Every receipt attempt is recorded on the payment_sessions row
 * (morning_status / morning_error / morning_document_id …, see
 * scripts/011_add_morning_receipt_tracking.sql) so that:
 *   - failed receipts show up in the admin panel (/admin/invoices) and can be
 *     re-sent from there;
 *   - the same session is never invoiced twice — several routes can reach the
 *     "payment succeeded" branch for one session (callback, 3ds-callback,
 *     3ds-complete), and each one used to send its own receipt.
 *
 * Before an attempt, the session is "claimed" with a conditional update
 * (status NULL / failed / stale 'sending' → 'sending'). Only the caller that
 * wins the claim talks to Morning.
 *
 * If the tracking columns do not exist yet (migration 011 not applied), the
 * automatic flows fall back to the old untracked behaviour: a receipt problem
 * must never take down a paid checkout.
 */

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendMorningReceiptLogged, detectPaymentMethod, searchMorningDocuments, type MorningReceiptParams, type MorningReceiptResult, type MorningDocumentSummary } from './morning'
import { buildLocalizedReceiptItems } from './product-titles'

/** A 'sending' claim older than this is considered dead (function killed mid-way). */
export const MORNING_SENDING_STALE_MS = 10 * 60 * 1000

export type MorningStatus = 'sending' | 'sent' | 'failed' | null

export interface IssueReceiptResult extends MorningReceiptResult {
  /** True when another attempt already sent (or is sending) this receipt. */
  skipped?: boolean
  /** True when the receipt was sent without bookkeeping (migration missing). */
  untracked?: boolean
}

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}

/** PostgREST filter: rows a new attempt may claim. */
export function claimableFilter(now = Date.now()): string {
  const staleIso = new Date(now - MORNING_SENDING_STALE_MS).toISOString()
  return `morning_status.is.null,morning_status.eq.failed,and(morning_status.eq.sending,morning_last_attempt_at.lt."${staleIso}")`
}

/** True when a Supabase error means the tracking columns are missing. */
export function isMissingTrackingColumns(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204' || /morning_/i.test(error.message || '')
}

/**
 * Send the Morning receipt for a session, at most once.
 *
 * @param tag       Log prefix, e.g. `[CALLBACK][abc123]`
 * @param sessionId payment_sessions.id
 * @param params    Receipt content
 * @param options.requireTracking  Manual resends set this: refuse to send when
 *                  the bookkeeping is unavailable instead of sending blind.
 *
 * Never rejects.
 */
export async function issueSessionReceipt(
  tag: string,
  sessionId: string,
  params: MorningReceiptParams,
  options: { requireTracking?: boolean } = {}
): Promise<IssueReceiptResult> {
  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (err: any) {
    if (options.requireTracking) return { success: false, error: err?.message || String(err) }
    console.error(`${tag} Morning tracking unavailable (${err?.message}) — sending untracked`)
    return { ...(await sendMorningReceiptLogged(tag, params)), untracked: true }
  }

  // ── Claim ────────────────────────────────────────────────────────────────
  const { data: claimed, error: claimError } = await supabase
    .from('payment_sessions')
    .update({ morning_status: 'sending', morning_last_attempt_at: new Date().toISOString() })
    .eq('id', sessionId)
    .or(claimableFilter())
    .select('id, morning_attempts')

  if (claimError) {
    const reason = isMissingTrackingColumns(claimError)
      ? 'tracking columns missing — run scripts/011_add_morning_receipt_tracking.sql'
      : claimError.message
    if (options.requireTracking) return { success: false, error: `Morning tracking unavailable: ${reason}` }
    console.error(`${tag} Morning receipt claim failed (${reason}) — sending untracked`)
    return { ...(await sendMorningReceiptLogged(tag, params)), untracked: true }
  }

  if (!claimed || claimed.length === 0) {
    console.log(`${tag} Morning receipt already sent or in progress for session ${sessionId} — skipping`)
    return { success: false, skipped: true, error: 'Receipt already sent or currently being sent' }
  }

  // ── Send ─────────────────────────────────────────────────────────────────
  const result = await sendMorningReceiptLogged(tag, params)

  // ── Record ───────────────────────────────────────────────────────────────
  const attempts = (Number(claimed[0].morning_attempts) || 0) + 1
  const { error: recordError } = await supabase
    .from('payment_sessions')
    .update(
      result.success
        ? {
            morning_status: 'sent',
            morning_document_id: result.documentId ?? null,
            morning_document_url: result.documentUrl ?? null,
            morning_error: null,
            morning_attempts: attempts,
            morning_last_attempt_at: new Date().toISOString(),
          }
        : {
            morning_status: 'failed',
            morning_error: (result.error || 'Unknown error').slice(0, 2000),
            morning_attempts: attempts,
            morning_last_attempt_at: new Date().toISOString(),
          }
    )
    .eq('id', sessionId)

  if (recordError) {
    console.error(`${tag} Failed to record Morning receipt outcome (non-fatal):`, recordError.message)
  }

  return result
}

/**
 * Amount the customer actually owes for the receipt: the cart total minus the
 * coupon typed in this checkout (not included in cart.total). Discounts from
 * the Shopify cart are already deducted from cart.total. A gift card is a
 * means of payment, not a discount, so it stays in the amount.
 */
export function paidReceiptAmount(session: any, couponAmount?: number): number {
  const coupon = couponAmount ?? Number(session?.raw_response?._coupon?.appliedAmount) ?? 0
  const total = Number(session?.cart?.total ?? session?.amount ?? 0)
  return Math.max(Math.round((total - (Number(coupon) || 0)) * 100) / 100, 0)
}

/**
 * Rebuild the receipt content from a stored session — used by the admin
 * resend. Mirrors what the checkout routes send at payment time.
 */
export async function buildReceiptParamsFromSession(session: any): Promise<MorningReceiptParams> {
  const customer = session.customer || {}
  const lang: 'he' | 'en' = session.cart?.language === 'en' ? 'en' : 'he'
  return {
    customerEmail: customer.email || '',
    customerName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
    amount: paidReceiptAmount(session),
    currency: session.cart?.currency || session.currency || 'ILS',
    paymentMethod: detectPaymentMethod(session.raw_response),
    items: await buildLocalizedReceiptItems(session.cart?.items || [], lang),
    // No paymentDate: the document is dated today. Morning (Israeli tax rules)
    // refuses a document dated before the last one already issued, so
    // back-dating a resend to the original payment day would fail.
    lang,
  }
}

// ─── Reconciliation with Morning ───────────────────────────────────────────────

/** Test-card checkouts: real Morning invoices must not be issued for them. */
export const isTestSession = (session: any) => session?.raw_response?.payment_method === 'test_card'

export interface ReconcileMissing {
  id: string
  created_at: string
  email: string
  name: string
  amount: number
  currency: string
}

export interface ReconcileResult {
  checked: number
  found: number
  missing: ReconcileMissing[]
  /** Test cards, zero amounts and sessions without email — left untouched. */
  skippedTests: number
  dryRun: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
const toDay = (iso: string) => new Date(iso).toISOString().slice(0, 10)

/**
 * Find which paid sessions with no recorded receipt (paid before tracking)
 * actually have a document in Morning.
 *
 * A session matches a document when: same customer email, same currency,
 * same amount (to the agorot — the paid amount, or the cart total for older
 * orders), and the document is dated between 1 day before and 3 days after
 * the payment. Credit notes (type 330) are ignored; each document matches at
 * most one session.
 *
 * Unless dryRun: matches are marked 'sent' (with the Morning document id),
 * the others 'failed' — so they appear in the "Failed" tab, ready to resend.
 * Test-card sessions are left alone.
 */
export async function reconcileMorningReceipts(
  { dryRun = false, since }: { dryRun?: boolean; since?: string } = {}
): Promise<ReconcileResult> {
  const supabase = getSupabase()

  let { data: sessions, error } = await supabase
    .from('payment_sessions')
    .select('id, created_at, amount, currency, customer, cart, raw_response')
    .eq('status', 'paid')
    .is('morning_status', null)
    .gte('created_at', since || '1970-01-01')
    .order('created_at', { ascending: true })
    .limit(1000)

  if (error && isMissingTrackingColumns(error)) {
    if (!dryRun) throw new Error('Tracking columns missing — run scripts/011_add_morning_receipt_tracking.sql')
    ;({ data: sessions, error } = await supabase
      .from('payment_sessions')
      .select('id, created_at, amount, currency, customer, cart, raw_response')
      .eq('status', 'paid')
      .gte('created_at', since || '1970-01-01')
      .order('created_at', { ascending: true })
      .limit(1000))
  }
  if (error) throw new Error(error.message)

  const all = sessions || []
  // Nothing to invoice: test cards, zero amounts, no email
  const real = all.filter(s => !isTestSession(s) && paidReceiptAmount(s) > 0 && s.customer?.email)
  const result: ReconcileResult = { checked: real.length, found: 0, missing: [], skippedTests: all.length - real.length, dryRun }
  if (real.length === 0) return result

  const from = toDay(new Date(new Date(real[0].created_at).getTime() - 2 * DAY_MS).toISOString())
  const to = toDay(new Date(Date.now() + DAY_MS).toISOString())
  const docs = (await searchMorningDocuments(from, to)).filter(d => d.type !== 330)
  const used = new Set<string>()

  for (const s of real) {
    const email = String(s.customer?.email || '').trim().toLowerCase()
    const currency = String(s.cart?.currency || s.currency || 'ILS').toUpperCase()
    const amounts = [paidReceiptAmount(s), Number(s.cart?.total ?? s.amount ?? 0)]
    const paidAt = new Date(s.created_at).getTime()

    let best: MorningDocumentSummary | null = null
    let bestGap = Infinity
    for (const d of docs) {
      if (used.has(d.id) || d.currency !== currency || !d.emails.includes(email)) continue
      if (!amounts.some(a => Math.abs(a - d.amount) < 0.01)) continue
      const gap = new Date(`${d.documentDate}T12:00:00Z`).getTime() - paidAt
      if (gap < -1.5 * DAY_MS || gap > 3.5 * DAY_MS) continue
      if (Math.abs(gap) < bestGap) { best = d; bestGap = Math.abs(gap) }
    }

    if (best) {
      used.add(best.id)
      result.found++
      if (!dryRun) {
        await supabase.from('payment_sessions').update({
          morning_status: 'sent',
          morning_document_id: best.id,
          morning_document_url: best.url ?? null,
          morning_error: null,
        }).eq('id', s.id).is('morning_status', null)
      }
    } else {
      result.missing.push({
        id: s.id,
        created_at: s.created_at,
        email,
        name: `${s.customer?.firstName || ''} ${s.customer?.lastName || ''}`.trim(),
        amount: paidReceiptAmount(s),
        currency,
      })
      if (!dryRun) {
        await supabase.from('payment_sessions').update({
          morning_status: 'failed',
          morning_error: `No document found in Morning (checked ${new Date().toISOString().slice(0, 10)})`,
        }).eq('id', s.id).is('morning_status', null)
      }
    }
  }

  return result
}
