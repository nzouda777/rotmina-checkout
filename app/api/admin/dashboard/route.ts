import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function checkAuth(req: NextRequest) {
  const key = req.headers.get('x-admin-key')
  return !!process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY
}

function startOf(unit: 'day' | 'week' | 'month'): string {
  const d = new Date()
  if (unit === 'day') {
    d.setHours(0, 0, 0, 0)
  } else if (unit === 'week') {
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
  } else {
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
  }
  return d.toISOString()
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()

  // Fetch all sessions for stats (status + amount + timestamps)
  const { data: allSessions, error } = await supabase
    .from('payment_sessions')
    .select('status, amount, created_at, customer, cart')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[ADMIN-DASHBOARD] Error fetching sessions:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }

  const sessions = allSessions || []

  const todayISO = startOf('day')
  const weekISO = startOf('week')
  const monthISO = startOf('month')

  const paid = sessions.filter((s) => s.status === 'paid')
  const failed = sessions.filter((s) => s.status === 'failed')
  const active = sessions.filter((s) => !['paid', 'failed', 'expired'].includes(s.status))

  const sumAmount = (arr: typeof sessions) =>
    arr.reduce((acc, s) => acc + Number(s.amount || 0), 0)

  const revenue = {
    today: sumAmount(paid.filter((s) => s.created_at >= todayISO)),
    thisWeek: sumAmount(paid.filter((s) => s.created_at >= weekISO)),
    thisMonth: sumAmount(paid.filter((s) => s.created_at >= monthISO)),
    allTime: sumAmount(paid),
  }

  const ordersByStatus = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1
    return acc
  }, {})

  const successRate =
    paid.length + failed.length > 0
      ? Math.round((paid.length / (paid.length + failed.length)) * 1000) / 10
      : 0

  const avgOrderValue =
    paid.length > 0
      ? Math.round((revenue.allTime / paid.length) * 100) / 100
      : 0

  // Recent 10 paid orders
  const recentOrders = paid.slice(0, 10).map((s) => ({
    ...s,
    cart: undefined, // strip large payload
  }))

  // Gift card stats
  const { data: gcData } = await supabase
    .from('gift_cards')
    .select('status, discount_type, original_amount')

  const giftCards = {
    total: gcData?.length || 0,
    active: gcData?.filter((g) => g.status === 'active').length || 0,
    totalAmountIssued: gcData
      ?.filter((g) => g.discount_type === 'amount' && g.original_amount != null)
      .reduce((sum, g) => sum + Number(g.original_amount), 0) || 0,
  }

  return NextResponse.json({
    revenue,
    orders: {
      ...ordersByStatus,
      total: sessions.length,
      paid: paid.length,
      failed: failed.length,
      active: active.length,
    },
    successRate,
    avgOrderValue,
    recentOrders,
    giftCards,
  })
}
