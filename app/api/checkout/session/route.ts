import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_ORIGINS = [
  'https://rotmina-israel.myshopify.com',
  'https://step-devserver.com',
  'https://rotmina.co.il',
  'https://www.rotmina.co.il'
]

function getCorsHeaders(request: Request | NextRequest) {
  const origin = request.headers.get('origin')
  const isAllowed = ALLOWED_ORIGINS.includes(origin || '')
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin! : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, ngrok-skip-browser-warning',
    'Access-Control-Allow-Credentials': 'true',
  }
}

function corsResponse(request: NextRequest, data: any, status: number = 200) {
  return NextResponse.json(data, {
    status,
    headers: getCorsHeaders(request),
  })
}

async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, { next: { revalidate: 3600 } });
    const data = await res.json();
    if (data?.rates?.[to]) return data.rates[to];
  } catch (e) {
    console.warn('[CURRENCY] Failed to fetch live exchange rate, using fallback');
  }
  if (from === 'USD' && to === 'ILS') return 3.75;
  if (from === 'EUR' && to === 'ILS') return 4.05;
  if (from === 'GBP' && to === 'ILS') return 4.75;
  return 1;
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

    // Calculate currency conversion if cart is not originally ILS
    const originalCurrency = cart?.currency || 'ILS';
    const rate = await getExchangeRate(originalCurrency, 'ILS');

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
          price: Math.round((item.price / 100) * rate * 100) / 100,
          image: item.image,
          variant: item.variant_title,
          sku: item.sku,
          properties: item.properties || undefined,
        })),
        subtotal: Math.round((cart.total_price / 100) * rate * 100) / 100,
        shipping: 0,
        tax: 0,
        total: Math.round((cart.total_price / 100) * rate * 100) / 100,
        currency: 'ILS'
      }
    } else if (finalCart && rate !== 1) {
      // If it's the pre-formatted cart but had a different currency
      finalCart.items = finalCart.items.map((item: any) => ({
        ...item,
        price: Math.round(item.price * rate * 100) / 100
      }));
      finalCart.subtotal = Math.round(finalCart.subtotal * rate * 100) / 100;
      finalCart.total = Math.round(finalCart.total * rate * 100) / 100;
      if (finalCart.shipping) finalCart.shipping = Math.round(finalCart.shipping * rate * 100) / 100;
      if (finalCart.tax) finalCart.tax = Math.round(finalCart.tax * rate * 100) / 100;
    }

    if (!shop || !finalCart) {
      console.error('Missing fields:', { 
        hasShop: !!shop, 
        hasCart: !!finalCart,
        body 
      })
      return corsResponse(request, { error: 'Missing required fields' }, 400)
    }

    // Force ILS locally so components don't display $ and Tranzila/Shopify act in ILS
    finalCart.currency = 'ILS';

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
        request,
        { error: 'Failed to create payment session' },
        500
      )
    }

    return corsResponse(request, { sessionId: data.id })
  } catch (error) {
    console.error('Session creation error:', error)
    return corsResponse(
      request,
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
        request,
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
        request,
        { error: 'Session not found' },
        404
      )
    }

    return corsResponse(request, data)
  } catch (error) {
    console.error('Session fetch error:', error)
    return corsResponse(
      request,
      { error: 'Internal server error' },
      500
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  })
}
