import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
  const adminKey = process.env.ADMIN_API_KEY
  return !!adminKey && key === adminKey
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('shipping_settings')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to load shipping settings' }, { status: 500 })
  }

  return NextResponse.json({ settings: data })
}

export async function PUT(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const threshold = Number(body.free_shipping_threshold_ils)
  const fee = Number(body.domestic_shipping_fee_ils)
  const pct = Number(body.international_shipping_pct)
  const enFee = Number(body.en_shipping_fee_usd)

  if (isNaN(threshold) || threshold < 0) {
    return NextResponse.json({ error: 'free_shipping_threshold_ils must be a non-negative number' }, { status: 400 })
  }
  if (isNaN(fee) || fee < 0) {
    return NextResponse.json({ error: 'domestic_shipping_fee_ils must be a non-negative number' }, { status: 400 })
  }
  if (isNaN(pct) || pct < 0 || pct > 100) {
    return NextResponse.json({ error: 'international_shipping_pct must be between 0 and 100' }, { status: 400 })
  }
  if (isNaN(enFee) || enFee < 0) {
    return NextResponse.json({ error: 'en_shipping_fee_usd must be a non-negative number' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('shipping_settings')
    .upsert({
      id: 1,
      free_shipping_threshold_ils: threshold,
      domestic_shipping_fee_ils: fee,
      international_shipping_pct: pct,
      en_shipping_fee_usd: enFee,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('[ADMIN] Failed to update shipping settings:', error)
    return NextResponse.json({ error: 'Failed to update shipping settings' }, { status: 500 })
  }

  return NextResponse.json({ settings: data })
}
