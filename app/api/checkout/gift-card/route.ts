import { NextRequest, NextResponse } from 'next/server'
import { validateGiftCard } from '@/lib/gift-cards'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
        { status: 400, headers: CORS_HEADERS }
      )
    }

    console.log(`[GIFT-CARD][${logId}] Validating code: ${code.trim().substring(0, 4)}****`)

    const card = await validateGiftCard(code)

    if (!card) {
      return NextResponse.json(
        { error: 'Gift card not found. Please check the code and try again.' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    if (card.status === 'disabled') {
      return NextResponse.json(
        { error: 'This gift card has been disabled.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (card.status === 'depleted' || card.balance <= 0) {
      return NextResponse.json(
        { error: 'This gift card has no remaining balance.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    console.log(`[GIFT-CARD][${logId}] Valid card. ID: ${card.id}, Balance: ${card.balance} ${card.currency}`)

    return NextResponse.json(
      {
        id: card.id,
        code: card.code,
        balance: card.balance,
        currency: card.currency,
      },
      { headers: CORS_HEADERS }
    )
  } catch (error: any) {
    console.error(`[GIFT-CARD][${logId}] CRITICAL ERROR:`, error)
    return NextResponse.json(
      { error: 'Unable to validate gift card. Please try again.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}
