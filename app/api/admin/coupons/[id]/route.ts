import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setShopifyDiscountActive } from '@/lib/shopify-discounts'

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
  const adminKey = process.env.ADMIN_API_KEY
  return !!adminKey && key === adminKey
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { status, applies_to_all, allowed_variant_ids } = body as {
    status?: string
    applies_to_all?: boolean
    allowed_variant_ids?: number[]
  }

  const updates: Record<string, unknown> = {}

  if (status !== undefined) {
    if (!['active', 'disabled'].includes(status)) {
      return NextResponse.json({ error: 'status must be "active" or "disabled"' }, { status: 400 })
    }
    updates.status = status
  }

  if (applies_to_all !== undefined) updates.applies_to_all = applies_to_all
  if (allowed_variant_ids !== undefined) updates.allowed_variant_ids = allowed_variant_ids

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const supabase = await createClient()

  // Shopify-sourced code: apply the status change in Shopify first, so the
  // storefront cart and this checkout stay in agreement.
  if (status !== undefined) {
    const { data: current } = await supabase.from('coupon_codes').select('*').eq('id', id).single()
    if (current?.source === 'shopify' && current.shopify_discount_id) {
      try {
        await setShopifyDiscountActive(current.shopify_discount_id, status === 'active')
      } catch (err: any) {
        return NextResponse.json({ error: `Shopify: ${err?.message || err}` }, { status: 502 })
      }
    }
  }

  const { data, error } = await supabase
    .from('coupon_codes')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to update coupon' }, { status: 500 })
  }

  return NextResponse.json({ coupon: data })
}
