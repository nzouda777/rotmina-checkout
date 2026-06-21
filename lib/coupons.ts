import { createClient } from '@/lib/supabase/server'

export interface CouponRecord {
  id: string
  code: string
  discount_type: 'amount' | 'percentage'
  discount_value: number
  currency: string
  status: 'active' | 'disabled' | 'depleted'
  max_uses: number | null
  current_uses: number
  note: string | null
  created_at: string
  updated_at: string
}

export async function validateCoupon(code: string): Promise<CouponRecord | null> {
  const supabase = await createClient()
  const normalized = code.trim().toUpperCase()

  const { data, error } = await supabase
    .from('coupon_codes')
    .select('*')
    .eq('code', normalized)
    .single()

  if (error || !data) return null
  return data as CouponRecord
}

export async function debitCoupon(code: string): Promise<void> {
  const supabase = await createClient()
  const normalized = code.trim().toUpperCase()

  const { data: coupon } = await supabase
    .from('coupon_codes')
    .select('*')
    .eq('code', normalized)
    .single()

  if (!coupon) return

  const newUses = (coupon.current_uses || 0) + 1
  const depleted = coupon.max_uses != null && newUses >= coupon.max_uses

  await supabase
    .from('coupon_codes')
    .update({
      current_uses: newUses,
      status: depleted ? 'depleted' : coupon.status,
    })
    .eq('code', normalized)
}

export async function createCoupon(params: {
  code?: string
  discountType: 'amount' | 'percentage'
  discountValue: number
  currency?: string
  maxUses?: number
  note?: string
}): Promise<CouponRecord> {
  const supabase = await createClient()

  const code = params.code
    ? params.code.trim().toUpperCase()
    : generateCouponCode()

  if (params.code) {
    const { data: existing } = await supabase
      .from('coupon_codes')
      .select('id')
      .eq('code', code)
      .single()
    if (existing) throw new Error(`Coupon code already exists: ${code}`)
  }

  const { data, error } = await supabase
    .from('coupon_codes')
    .insert({
      code,
      discount_type: params.discountType,
      discount_value: params.discountValue,
      currency: params.currency || 'ILS',
      status: 'active',
      max_uses: params.maxUses ?? null,
      current_uses: 0,
      note: params.note || null,
    })
    .select()
    .single()

  if (error || !data) throw new Error('Failed to create coupon code')
  return data as CouponRecord
}

function generateCouponCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-'
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}
