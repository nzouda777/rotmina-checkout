import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCoupon } from '@/lib/coupons'

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
  const adminKey = process.env.ADMIN_API_KEY
  return !!adminKey && key === adminKey
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || 'all'
  const type = searchParams.get('type') || 'all'
  const search = searchParams.get('search') || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = 20

  const supabase = await createClient()

  let query = supabase
    .from('coupon_codes')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (status !== 'all') query = query.eq('status', status)
  if (type !== 'all') query = query.eq('discount_type', type)
  if (search) query = query.ilike('code', `%${search}%`)

  const { data: coupons, error, count } = await query

  if (error) {
    console.error('[ADMIN] Failed to fetch coupons:', error)
    return NextResponse.json({ error: 'Failed to fetch coupons' }, { status: 500 })
  }

  let stats = null
  if (page === 1 && status === 'all' && type === 'all' && !search) {
    const { data: all } = await supabase
      .from('coupon_codes')
      .select('status, discount_type, current_uses')

    if (all) {
      stats = {
        total: all.length,
        active: all.filter((c) => c.status === 'active').length,
        depleted: all.filter((c) => c.status === 'depleted').length,
        disabled: all.filter((c) => c.status === 'disabled').length,
        totalUses: all.reduce((sum, c) => sum + (c.current_uses || 0), 0),
        percentageCoupons: all.filter((c) => c.discount_type === 'percentage').length,
      }
    }
  }

  return NextResponse.json({ coupons, total: count, page, limit, stats })
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { discountType, discountValue, code, maxUses, note, quantity } = body as {
    discountType?: string
    discountValue?: number
    code?: string
    maxUses?: number
    note?: string
    quantity?: number
  }

  if (!discountType || !['amount', 'percentage'].includes(discountType)) {
    return NextResponse.json({ error: 'discountType must be "amount" or "percentage"' }, { status: 400 })
  }
  if (!discountValue || Number(discountValue) <= 0) {
    return NextResponse.json({ error: 'discountValue must be greater than 0' }, { status: 400 })
  }
  if (discountType === 'percentage' && Number(discountValue) > 100) {
    return NextResponse.json({ error: 'Percentage must be between 1 and 100' }, { status: 400 })
  }

  const customCode = code?.trim() || undefined
  const qty = customCode ? 1 : Math.min(Math.max(1, parseInt(String(quantity ?? 1))), 20)
  const created = []

  try {
    for (let i = 0; i < qty; i++) {
      const coupon = await createCoupon({
        code: customCode,
        discountType: discountType as 'amount' | 'percentage',
        discountValue: Number(discountValue),
        maxUses: maxUses ? Number(maxUses) : undefined,
        note: note || undefined,
      })
      created.push(coupon)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create coupon'
    return NextResponse.json({ error: message }, { status: 409 })
  }

  return NextResponse.json({ coupons: created }, { status: 201 })
}
