import { NextRequest, NextResponse } from 'next/server'
import { syncShopifyDiscounts } from '@/lib/shopify-discounts'

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
  const adminKey = process.env.ADMIN_API_KEY
  return !!adminKey && key === adminKey
}

/** POST /api/admin/coupons/sync-shopify — mirror Shopify discount codes into coupon_codes. */
export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncShopifyDiscounts()
    console.log('[ADMIN] Shopify discount sync:', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err: any) {
    const message = err?.message || String(err)
    console.error('[ADMIN] Shopify discount sync failed:', message)
    // Missing columns from migration 012
    if (/source|shopify_|checkout_usable|synced_at|starts_at|ends_at/i.test(message) && /column/i.test(message)) {
      return NextResponse.json({ migrationRequired: true, error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
