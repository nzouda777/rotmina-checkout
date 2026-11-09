import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  issueSessionReceipt,
  buildReceiptParamsFromSession,
  isMissingTrackingColumns,
  MORNING_SENDING_STALE_MS,
  isTestSession,
} from '@/lib/morning-receipts'

function checkAuth(req: NextRequest) {
  const key = req.headers.get('x-admin-key')
  return !!process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY
}

const LIMIT = 25
const FILTERS = ['failed', 'untracked', 'sent', 'all'] as const
type Filter = typeof FILTERS[number]

const MIGRATION_MSG = 'Run scripts/011_add_morning_receipt_tracking.sql in Supabase to enable invoice tracking.'

/**
 * GET /api/admin/morning-receipts?filter=failed|untracked|sent|all&page=1&search=
 *
 * Paid sessions with their Morning receipt status.
 *  - failed:    last attempt failed, or an attempt stuck in 'sending' > 10 min
 *  - untracked: paid with no recorded attempt (mostly orders paid before tracking existed)
 */
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const filter: Filter = (FILTERS as readonly string[]).includes(searchParams.get('filter') || '')
    ? (searchParams.get('filter') as Filter)
    : 'failed'
  const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
  const search = (searchParams.get('search') || '').trim()

  const supabase = await createClient()
  const staleIso = new Date(Date.now() - MORNING_SENDING_STALE_MS).toISOString()
  const failedOr = `morning_status.eq.failed,and(morning_status.eq.sending,morning_last_attempt_at.lt."${staleIso}")`

  let query = supabase
    .from('payment_sessions')
    .select(
      'id, shop, status, amount, currency, customer, cart, order_id, tranzila_transaction_id, created_at, updated_at, ' +
      'morning_status, morning_document_id, morning_document_url, morning_error, morning_attempts, morning_last_attempt_at, ' +
      'payment_method:raw_response->>payment_method',
      { count: 'exact' }
    )
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .range((page - 1) * LIMIT, page * LIMIT - 1)

  if (filter === 'failed') query = query.or(failedOr)
  else if (filter === 'untracked') query = query.is('morning_status', null)
  else if (filter === 'sent') query = query.eq('morning_status', 'sent')

  if (search) {
    if (/^[0-9a-f-]{8,}$/i.test(search)) query = query.ilike('id', `${search}%`)
    else query = query.or(`order_id.ilike.%${search}%,customer->>email.ilike.%${search}%`)
  }

  const { data, error, count } = await query

  if (error) {
    if (isMissingTrackingColumns(error)) {
      return NextResponse.json({ migrationRequired: true, error: MIGRATION_MSG }, { status: 409 })
    }
    console.error('[ADMIN-MORNING] List error:', error)
    return NextResponse.json({ error: 'Failed to fetch receipts' }, { status: 500 })
  }

  // Counters for the tabs
  const [failedCount, untrackedCount] = await Promise.all([
    supabase.from('payment_sessions').select('id', { count: 'exact', head: true }).eq('status', 'paid').or(failedOr),
    supabase.from('payment_sessions').select('id', { count: 'exact', head: true }).eq('status', 'paid').is('morning_status', null),
  ])

  const rows = (data || []).map(({ payment_method, ...row }: any) => ({
    ...row,
    is_test: payment_method === 'test_card',
    morning_status:
      row.morning_status === 'sending' && row.morning_last_attempt_at &&
      new Date(row.morning_last_attempt_at).getTime() < Date.now() - MORNING_SENDING_STALE_MS
        ? 'stuck'
        : row.morning_status,
  }))

  return NextResponse.json({
    sessions: rows,
    total: count || 0,
    page,
    limit: LIMIT,
    counts: { failed: failedCount.count || 0, untracked: untrackedCount.count || 0 },
  })
}

/**
 * POST /api/admin/morning-receipts  { sessionId }
 *
 * Re-issue the Morning receipt of a paid session. Refused when the receipt is
 * already recorded as sent (or currently being sent) — never invoices twice.
 */
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { body = {} }
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const supabase = await createClient()
  const { data: session, error } = await supabase
    .from('payment_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (error || !session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status !== 'paid') {
    return NextResponse.json({ error: `Session is '${session.status}', not paid` }, { status: 400 })
  }
  if (!('morning_status' in session)) {
    return NextResponse.json({ migrationRequired: true, error: MIGRATION_MSG }, { status: 409 })
  }
  if (session.morning_status === 'sent') {
    return NextResponse.json({ error: 'Receipt already sent for this order' }, { status: 409 })
  }
  if (isTestSession(session)) {
    return NextResponse.json({ error: 'Test-card order — no real invoice should be issued' }, { status: 400 })
  }
  if (!session.customer?.email) {
    return NextResponse.json({ error: 'Session has no customer email' }, { status: 400 })
  }

  const params = await buildReceiptParamsFromSession(session)
  const result = await issueSessionReceipt(`[ADMIN-MORNING][${sessionId}]`, sessionId, params, { requireTracking: true })

  if (result.skipped) {
    return NextResponse.json({ error: 'Receipt already sent or currently being sent — refresh the list' }, { status: 409 })
  }
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 })
  }
  return NextResponse.json({ success: true, documentId: result.documentId, documentUrl: result.documentUrl })
}
