import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    .select('id, shop, status, amount, currency, customer, cart, order_id, tranzila_transaction_id, error_message, created_at, updated_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (status !== 'all') query = query.eq('status', status)
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

  return NextResponse.json({ sessions, total: count, page, limit })
}
