import { NextRequest, NextResponse } from 'next/server'
import { validateCheckoutCoupon } from '@/lib/coupons'

const ALLOWED_ORIGINS = [
  'https://rotmina-israel.myshopify.com',
  'https://step-devserver.com',
  'https://rotmina.com.il',
  'https://www.rotmina.com.il',
  'https://rotmina.com',
  'https://www.rotmina.com',
]

function getCorsHeaders(request: Request | NextRequest) {
  const origin = request.headers.get('origin')
  const isAllowed = ALLOWED_ORIGINS.includes(origin || '')
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin! : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json()

    if (!code || typeof code !== 'string' || code.trim().length < 2) {
      return NextResponse.json(
        { errorCode: 'INVALID_INPUT', error: 'Please enter a valid coupon code' },
        { status: 400, headers: getCorsHeaders(request) }
      )
    }

    const coupon = await validateCheckoutCoupon(code)

    if (!coupon) {
      return NextResponse.json(
        { errorCode: 'NOT_FOUND', error: 'Coupon code not found.' },
        { status: 404, headers: getCorsHeaders(request) }
      )
    }

    if (coupon.status === 'disabled') {
      return NextResponse.json(
        { errorCode: 'DISABLED', error: 'This coupon code has been disabled.' },
        { status: 400, headers: getCorsHeaders(request) }
      )
    }

    // Shopify code with conditions this checkout cannot check (minimum, specific
    // products/customers, once per customer, free shipping, BXGY…): it has to be
    // applied in the Shopify cart, where Shopify enforces those conditions.
    if (coupon.checkout_usable === false) {
      return NextResponse.json(
        { errorCode: 'SHOPIFY_CART_ONLY', error: 'This code can only be applied in the store cart.' },
        { status: 400, headers: getCorsHeaders(request) }
      )
    }

    const now = Date.now()
    if ((coupon.starts_at && new Date(coupon.starts_at).getTime() > now) ||
        (coupon.ends_at && new Date(coupon.ends_at).getTime() < now)) {
      return NextResponse.json(
        { errorCode: 'DISABLED', error: 'This coupon code is not active.' },
        { status: 400, headers: getCorsHeaders(request) }
      )
    }

    if (coupon.status === 'depleted') {
      return NextResponse.json(
        { errorCode: 'DEPLETED', error: 'This coupon code has reached its usage limit.' },
        { status: 400, headers: getCorsHeaders(request) }
      )
    }

    return NextResponse.json(
      {
        id: coupon.id,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        currency: coupon.currency,
        max_uses: coupon.max_uses,
        current_uses: coupon.current_uses,
      },
      { headers: getCorsHeaders(request) }
    )
  } catch {
    return NextResponse.json(
      { errorCode: 'SERVER_ERROR', error: 'Unable to validate coupon. Please try again.' },
      { status: 500, headers: getCorsHeaders(request) }
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  })
}
