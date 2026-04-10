import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://rotmina-israel.myshopify.com',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, ngrok-skip-browser-warning',
  'Access-Control-Allow-Credentials': 'true',
}

function corsResponse(data: any, status: number = 200) {
  return NextResponse.json(data, {
    status,
    headers: CORS_HEADERS,
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      shop: bodyShop, 
      idempotency_key, 
      idempotencyKey: bodyIdempotencyKey, 
      cart 
    } = body

    const shop = bodyShop || process.env.SHOPIFY_STORE_DOMAIN
    const idempotencyKey = bodyIdempotencyKey || idempotency_key || Math.random().toString(36).substring(2) + Date.now().toString(36)

    // Handle raw Shopify cart format if detected
    let finalCart = cart
    if (cart && cart.token && cart.items && !cart.subtotal) {
      finalCart = {
        items: cart.items.map((item: any) => ({
          id: String(item.id),
          variant_id: item.variant_id,
          product_id: item.product_id,
          title: item.title,
          quantity: item.quantity,
          price: item.price / 100,
          image: item.image,
          variant: item.variant_title,
          sku: item.sku,
          properties: item.properties || undefined,
        })),
        subtotal: cart.total_price / 100,
        shipping: 0,
        tax: 0,
        total: cart.total_price / 100,
        currency: cart.currency || 'ILS'
      }
    }

    if (!shop || !finalCart) {
      console.error('Missing fields:', { 
        hasShop: !!shop, 
        hasCart: !!finalCart,
        body 
      })
      return corsResponse(
        { error: 'Missing required fields', details: { shop: !!shop, cart: !!finalCart } },
        400
      )
    }

    const supabase = await createClient()

    const { data, error } = await supabase
      .from('payment_sessions')
      .insert({
        shop,
        idempotency_key: idempotencyKey,
        cart: finalCart,
        amount: finalCart.total,
        currency: finalCart.currency || 'ILS',
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating session:', error)
      return corsResponse(
        { error: 'Failed to create payment session' },
        500
      )
    }

    return corsResponse({ sessionId: data.id })
  } catch (error) {
    console.error('Session creation error:', error)
    return corsResponse(
      { error: 'Internal server error' },
      500
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('id')

    if (!sessionId) {
      return corsResponse(
        { error: 'Session ID required' },
        400
      )
    }

    const supabase = await createClient()

    const { data, error } = await supabase
      .from('payment_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (error || !data) {
      return corsResponse(
        { error: 'Session not found' },
        404
      )
    }

    return corsResponse(data)
  } catch (error) {
    console.error('Session fetch error:', error)
    return corsResponse(
      { error: 'Internal server error' },
      500
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}
