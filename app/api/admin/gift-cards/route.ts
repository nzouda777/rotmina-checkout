import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createGiftCard } from '@/lib/gift-cards'

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
    .from('gift_cards')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (status !== 'all') query = query.eq('status', status)
  if (type !== 'all') query = query.eq('discount_type', type)
  if (search) {
    query = query.or(
      `code.ilike.%${search}%,buyer_email.ilike.%${search}%,recipient_email.ilike.%${search}%`
    )
  }

  const { data: cards, error, count } = await query

  if (error) {
    console.error('[ADMIN] Failed to fetch gift cards:', error)
    return NextResponse.json({ error: 'Failed to fetch gift cards' }, { status: 500 })
  }

  // Stats — only compute on first page with no filters to avoid extra query cost
  let stats = null
  if (page === 1 && status === 'all' && type === 'all' && !search) {
    const { data: all } = await supabase
      .from('gift_cards')
      .select('status, discount_type, balance, original_amount')

    if (all) {
      stats = {
        total: all.length,
        active: all.filter((c) => c.status === 'active').length,
        depleted: all.filter((c) => c.status === 'depleted').length,
        disabled: all.filter((c) => c.status === 'disabled').length,
        percentageCards: all.filter((c) => c.discount_type === 'percentage').length,
        totalAmountIssued: all
          .filter((c) => c.discount_type === 'amount' && c.original_amount != null)
          .reduce((sum, c) => sum + Number(c.original_amount), 0),
      }
    }
  }

  return NextResponse.json({ cards, total: count, page, limit, stats })
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

  const { discountType, amount, discountValue, code, recipientEmail, note, quantity } = body as {
    discountType?: string
    amount?: number
    discountValue?: number
    code?: string
    recipientEmail?: string
    note?: string
    quantity?: number
  }

  if (!discountType || !['amount', 'percentage'].includes(discountType)) {
    return NextResponse.json({ error: 'discount_type must be "amount" or "percentage"' }, { status: 400 })
  }
  if (discountType === 'amount' && (!amount || Number(amount) <= 0)) {
    return NextResponse.json({ error: 'amount must be greater than 0' }, { status: 400 })
  }
  if (discountType === 'percentage') {
    const pct = Number(discountValue)
    if (!pct || pct < 1 || pct > 100) {
      return NextResponse.json({ error: 'discountValue (percentage) must be between 1 and 100' }, { status: 400 })
    }
  }

  const customCode = code?.trim() || undefined
  // A custom code can only be used for a single card
  const qty = customCode ? 1 : Math.min(Math.max(1, parseInt(String(quantity ?? 1))), 20)
  const created = []

  try {
    for (let i = 0; i < qty; i++) {
      const card = await createGiftCard({
        discountType: discountType as 'amount' | 'percentage',
        amount: discountType === 'amount' ? Number(amount) : undefined,
        discountValue: discountType === 'percentage' ? Number(discountValue) : undefined,
        code: customCode,
        recipientEmail: recipientEmail || undefined,
        buyerEmail: 'admin',
        personalMessage: note || undefined,
      })
      created.push(card)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create gift card'
    return NextResponse.json({ error: message }, { status: 409 })
  }

  return NextResponse.json({ cards: created }, { status: 201 })
}
