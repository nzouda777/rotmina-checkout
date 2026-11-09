import { createClient } from '@/lib/supabase/server'
import { lookupShopifyDiscountCode, upsertShopifyDiscount, setShopifyDiscountActive, normalizeCode } from '@/lib/shopify-discounts'

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
  applies_to_all: boolean
  allowed_variant_ids: number[]
  created_at: string
  updated_at: string
  // Migration 012 — absent on databases where it has not been applied
  source?: 'local' | 'shopify'
  shopify_discount_id?: string | null
  shopify_title?: string | null
  shopify_kind?: string | null
  checkout_usable?: boolean
  starts_at?: string | null
  ends_at?: string | null
  synced_at?: string | null
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

/**
 * Coupon lookup for the checkout coupon form.
 *
 * Codes created in Shopify are looked up live (and mirrored into coupon_codes)
 * so a code created a minute ago in Shopify works right away, and a mirrored
 * code always reflects its current Shopify status. If Shopify is unreachable,
 * the mirrored row is used as-is.
 */
export async function validateCheckoutCoupon(code: string): Promise<CouponRecord | null> {
  const local = await validateCoupon(code)
  if (local && local.source !== 'shopify') return local

  try {
    const discount = await lookupShopifyDiscountCode(code)
    if (!discount) {
      // Deleted in Shopify since the last sync
      return local ? { ...local, status: 'disabled', checkout_usable: false } : null
    }
    await upsertShopifyDiscount(discount)
    return (await validateCoupon(code)) ?? null
  } catch (err: any) {
    console.error(`[COUPONS] Shopify lookup failed for "${code}" (using mirrored row if any):`, err?.message || err)
    return local
  }
}

/**
 * Count one use of a code. Works for local coupons and for Shopify codes —
 * a Shopify code that was never synced is mirrored first. When a Shopify
 * code reaches its usage limit it is deactivated in Shopify as well.
 */
export async function markCouponUsed(code: string, tag = '[COUPONS]'): Promise<void> {
  const supabase = await createClient()
  const normalized = normalizeCode(code)

  let { data: coupon } = await supabase.from('coupon_codes').select('*').eq('code', normalized).maybeSingle()

  if (!coupon) {
    try {
      const discount = await lookupShopifyDiscountCode(code)
      if (discount) {
        await upsertShopifyDiscount(discount)
        ;({ data: coupon } = await supabase.from('coupon_codes').select('*').eq('code', normalized).maybeSingle())
      }
    } catch (err: any) {
      console.error(`${tag} Shopify lookup failed for "${code}":`, err?.message || err)
    }
  }

  if (!coupon) {
    console.warn(`${tag} Code "${code}" not found locally nor in Shopify — usage not recorded`)
    return
  }

  const newUses = (coupon.current_uses || 0) + 1
  const depleted = coupon.max_uses != null && newUses >= coupon.max_uses

  await supabase
    .from('coupon_codes')
    .update({ current_uses: newUses, status: depleted ? 'depleted' : coupon.status })
    .eq('id', coupon.id)
  console.log(`${tag} Code ${normalized} used (${newUses}${coupon.max_uses != null ? `/${coupon.max_uses}` : ''})`)

  if (coupon.source === 'shopify' && coupon.shopify_discount_id) {
    await enforceShopifyUsageLimit(supabase, coupon.shopify_discount_id, code, tag)
  }
}

/** Deactivate the Shopify discount once its usage limit is reached by orders paid here. */
async function enforceShopifyUsageLimit(supabase: any, discountId: string, code: string, tag: string) {
  try {
    const live = await lookupShopifyDiscountCode(code)
    if (!live || live.usageLimit == null) return

    // A discount can have several codes; the limit covers all of them.
    const { data: rows } = await supabase
      .from('coupon_codes').select('current_uses').eq('shopify_discount_id', discountId)
    const localUses = (rows || []).reduce((s: number, r: any) => s + (Number(r.current_uses) || 0), 0)
    const totalUses = Math.max(localUses, live.usageCount)

    if (totalUses < live.usageLimit) return

    if (live.status === 'ACTIVE') {
      await setShopifyDiscountActive(discountId, false)
      console.log(`${tag} Shopify discount "${live.title}" reached its limit (${totalUses}/${live.usageLimit}) — deactivated in Shopify`)
    }
    await supabase.from('coupon_codes').update({ status: 'depleted' }).eq('shopify_discount_id', discountId)
  } catch (err: any) {
    console.error(`${tag} Could not enforce Shopify usage limit for "${code}":`, err?.message || err)
  }
}

/** @deprecated use markCouponUsed */
export const debitCoupon = (code: string) => markCouponUsed(code)

/**
 * Record usage of every discount code of a paid session, exactly once.
 *
 * Codes come from the coupon typed in this checkout (raw_response._coupon, or
 * `extraCodes` when the caller has it directly) and from discounts applied in
 * the Shopify cart (cart.shopify_discount.codes).
 *
 * Several routes can reach "payment succeeded" for one session; the first one
 * claims payment_sessions.discounts_recorded_at, the others skip.
 * Never rejects.
 */
export async function recordSessionDiscountUsage(
  tag: string,
  session: any,
  extraCodes: (string | undefined | null)[] = []
): Promise<void> {
  try {
    const codes = new Set<string>()
    const add = (c: unknown) => { if (typeof c === 'string' && c.trim()) codes.add(normalizeCode(c)) }
    add(session?.raw_response?._coupon?.code)
    extraCodes.forEach(add)
    for (const c of session?.cart?.shopify_discount?.codes || []) add(c?.code)
    if (codes.size === 0) return

    const supabase = await createClient()
    const { data: claimed, error } = await supabase
      .from('payment_sessions')
      .update({ discounts_recorded_at: new Date().toISOString() })
      .eq('id', session.id)
      .is('discounts_recorded_at', null)
      .select('id')

    if (error) {
      console.error(`${tag} Discount usage claim failed (${error.message}) — run scripts/012_shopify_discount_sync.sql. Recording anyway.`)
    } else if (!claimed || claimed.length === 0) {
      console.log(`${tag} Discount usage already recorded for session ${session.id} — skipping`)
      return
    }

    for (const code of codes) await markCouponUsed(code, tag)
  } catch (err: any) {
    console.error(`${tag} Recording discount usage failed (non-fatal):`, err?.message || err)
  }
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
