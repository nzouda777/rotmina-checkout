import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { explainTransaction } from '@/lib/transaction-insight'

function checkAuth(req: NextRequest) {
  const key = req.headers.get('x-admin-key')
  return !!process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = 25
  const status = searchParams.get('status') || 'all'
  const search = searchParams.get('search') || ''
  const from = searchParams.get('from') || ''
  const to = searchParams.get('to') || ''

  const supabase = await createClient()

  let query = supabase
    .from('payment_sessions')
    .select('id, shop, status, amount, currency, customer, cart, order_id, tranzila_transaction_id, error_message, raw_response, created_at, updated_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (status === 'failed') {
    // Declined attempts are reset to 'pending' so the customer can retry —
    // include those that were never retried successfully.
    query = query.or('status.eq.failed,and(status.eq.pending,raw_response->_last_failure.not.is.null)')
  } else if (status !== 'all') {
    query = query.eq('status', status)
  }
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  if (search) {
    // Search by session id prefix OR customer email OR order_id
    const isUUID = /^[0-9a-f-]{8,}/i.test(search)
    if (isUUID) {
      query = query.ilike('id', `${search}%`)
    } else {
      // Use raw filter for JSONB customer->email
      query = query.or(`order_id.ilike.%${search}%,customer->>email.ilike.%${search}%`)
    }
  }

  const { data: sessions, error, count } = await query

  if (error) {
    console.error('[ADMIN-SESSIONS] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
  }

  // Ship the interpreted outcome instead of the (large) raw gateway response
  const rows = (sessions || []).map(({ raw_response, ...row }) => ({
    ...row,
    insight: explainTransaction({ ...row, raw_response }),
  }))

  return NextResponse.json({ sessions: rows, total: count, page, limit })
}
