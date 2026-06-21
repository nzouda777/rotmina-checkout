import { NextRequest, NextResponse } from 'next/server'
import { validateGiftCard } from '@/lib/gift-cards'

const ALLOWED_ORIGINS = [
  'https://rotmina-israel.myshopify.com',
  'https://step-devserver.com',
  'https://rotmina.co.il',
  'https://www.rotmina.co.il',
  'https://rotmina.co',
  'https://www.rotmina.co'
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

/**
 * POST /api/checkout/gift-card
 * Validates a gift card code against our custom Supabase-backed system.
 * 
 * Body: { code: string }
 * Returns: { id, code, balance, currency } or error
 */
export async function POST(request: NextRequest) {
  const logId = Math.random().toString(36).substring(7)
  console.log(`[GIFT-CARD][${logId}] Validation request started`)

  try {
    const body = await request.json()
    const { code } = body

    if (!code || typeof code !== 'string' || code.trim().length < 4) {
      return NextResponse.json(
        { error: 'Please enter a valid gift card code' },
        { status: 400, headers: getCorsHeaders(request) }
      )
    }

    console.log(`[GIFT-CARD][${logId}] Validating code: ${code.trim().substring(0, 4)}****`)

    const card = await validateGiftCard(code)

    if (!card) {
      return NextResponse.json(
        { error: 'Gift card not found. Please check the code and try again.' },
        { status: 404, headers: getCorsHeaders(request) }
      )
    }

    if (card.status === 'disabled') {
      return NextResponse.json(
        { error: 'This gift card has been disabled.' },
        { status: 400, headers: getCorsHeaders(request) }
      )
    }

    const isPercentage = card.discount_type === 'percentage'

    if (!isPercentage && (card.status === 'depleted' || (card.balance ?? 0) <= 0)) {
      return NextResponse.json(
        { error: 'This gift card has no remaining balance.' },
        { status: 400, headers: getCorsHeaders(request) }
      )
    }

    if (isPercentage) {
      console.log(`[GIFT-CARD][${logId}] Valid percentage card. ID: ${card.id}, ${card.discount_value}% off`)
    } else {
      console.log(`[GIFT-CARD][${logId}] Valid amount card. ID: ${card.id}, Balance: ${card.balance} ${card.currency}`)
    }

    return NextResponse.json(
      {
        id: card.id,
        code: card.code,
        balance: card.balance,
        currency: card.currency,
        discount_type: card.discount_type || 'amount',
        discount_value: card.discount_value,
      },
      { headers: getCorsHeaders(request) }
    )
  } catch (error: any) {
    console.error(`[GIFT-CARD][${logId}] CRITICAL ERROR:`, error)
    return NextResponse.json(
      { error: 'Unable to validate gift card. Please try again.' },
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
