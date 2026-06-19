import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { randomInt } from 'crypto'
import { separateGiftCardItems } from '@/lib/gift-card-utils'

const FREE_SHIPPING_THRESHOLD_ILS = 499
const DOMESTIC_SHIPPING_FEE_ILS = Number(process.env.DOMESTIC_SHIPPING_FEE_ILS || '25')

function sanitizeShopDomain(shop: string): string {
  return shop.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

async function enrichItemsWithProductImages(items: any[]): Promise<any[]> {
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN
  const shopDomain = sanitizeShopDomain(process.env.SHOPIFY_STORE_DOMAIN || '')
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-04'

  if (!accessToken || !shopDomain) {
    console.warn('[IMAGES] Missing SHOPIFY_ACCESS_TOKEN or SHOPIFY_STORE_DOMAIN — skipping product image fetch')
    return items
  }

  const uniqueIds = [...new Set(
    items.map((i) => String(i.product_id || '').replace(/\D/g, '')).filter(Boolean)
  )]

  if (uniqueIds.length === 0) {
    console.warn('[IMAGES] No product_id found on cart items — cannot fetch product images')
    return items
  }

  const results = await Promise.allSettled(
    uniqueIds.map(async (numericId) => {
      const res = await fetch(
        `https://${shopDomain}/admin/api/${apiVersion}/products/${numericId}.json?fields=id,image`,
        { headers: { 'X-Shopify-Access-Token': accessToken } }
      )
      if (!res.ok) {
        console.warn(`[IMAGES] Failed to fetch product ${numericId}: ${res.status}`)
        return null
      }
      const data = await res.json()
      const src: string | null = data.product?.image?.src ?? null
      console.log(`[IMAGES] Product ${numericId} main image: ${src}`)
      return src ? { id: numericId, src } : null
    })
  )

  const imageMap: Record<string, string> = {}
  results.forEach((r) => {
    if (r.status === 'fulfilled' && r.value) {
      imageMap[r.value.id] = r.value.src
    }
  })

  return items.map((item) => {
    const numericId = String(item.product_id || '').replace(/\D/g, '')
    const mainImage = imageMap[numericId] ?? item.product?.featured_image ?? item.image ?? null
    return { ...item, product: { ...item.product, featured_image: mainImage } }
  })
}

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
    // Shopify cart can have 'currency' or 'currency_code'
    const originalCurrency = (cart?.currency || cart?.currency_code || 'ILS').toUpperCase();
    console.log(`[CURRENCY] Detected original currency: ${originalCurrency}`);
    const rate = await getExchangeRate(originalCurrency, 'ILS');
    console.log(`[CURRENCY] Conversion rate to ILS: ${rate}`);

    // Handle raw Shopify cart format if detected (prices in cents)
    let finalCart = cart
    if (cart && (cart.token || cart.items) && !cart.subtotal) {
      console.log(`[CURRENCY] Processing raw Shopify cart in cents. Total price in cents: ${cart.total_price}`);
      finalCart = {
        items: (cart.items || []).map((item: any) => ({
          id: String(item.id),
          variant_id: item.variant_id,
          product_id: item.product_id,
          handle: item.handle,
          url: item.url,
          title: item.title,
          quantity: item.quantity,
          price: Math.round((item.price / 100) * rate * 100) / 100,
          image: item.image,
          product: {
            featured_image: item.featured_image?.url ?? item.image ?? null,
          },
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
      console.log(`[CURRENCY] Converted raw total to ILS: ${finalCart.total}`);
    } else if (finalCart && rate !== 1) {
      console.log(`[CURRENCY] Converting pre-formatted cart. Original total: ${finalCart.total}`);
      // If it's the pre-formatted cart but had a different currency (prices in decimal)
      finalCart.items = (finalCart.items || []).map((item: any) => ({
        ...item,
        price: Math.round(item.price * rate * 100) / 100
      }));
      finalCart.subtotal = Math.round(finalCart.subtotal * rate * 100) / 100;
      finalCart.total = Math.round(finalCart.total * rate * 100) / 100;
      if (finalCart.shipping) finalCart.shipping = Math.round(finalCart.shipping * rate * 100) / 100;
      if (finalCart.tax) finalCart.tax = Math.round(finalCart.tax * rate * 100) / 100;
      console.log(`[CURRENCY] Converted formatted total to ILS: ${finalCart.total}`);
    }

    if (!shop || !finalCart) {
      console.error('Missing fields:', {
        hasShop: !!shop,
        hasCart: !!finalCart,
        body
      })
      return corsResponse(request, { error: 'Missing required fields' }, 400)
    }

    // Fetch main product images from Shopify Admin API and enrich each item
    finalCart.items = await enrichItemsWithProductImages(finalCart.items || [])

    // Force ILS locally so components don't display $ and Tranzila/Shopify act in ILS
    finalCart.currency = 'ILS';

    // ── Shipping threshold logic ──────────────────────────────────────────────
    // Gift card-only orders are digital → always free shipping.
    // For regular orders: free shipping at ₪499+, otherwise a flat domestic fee.
    const { regularItems: regularCartItems } = separateGiftCardItems(finalCart.items || [])
    const isGiftCardOnlyCart = regularCartItems.length === 0 && (finalCart.items || []).length > 0
    const subtotalForShipping = finalCart.subtotal || 0

    if (isGiftCardOnlyCart || subtotalForShipping >= FREE_SHIPPING_THRESHOLD_ILS) {
      finalCart.shipping = 0
    } else {
      finalCart.shipping = DOMESTIC_SHIPPING_FEE_ILS
    }
    finalCart.total = Math.round((subtotalForShipping + finalCart.shipping + (finalCart.tax || 0)) * 100) / 100

    const supabase = await createClient()
    const orderId = randomInt(0, 9999) 

    const { data, error } = await supabase
      .from('payment_sessions')
      .insert({
        shop,
        order_id: orderId,
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

    // Enrich product images on every load (covers sessions created before this fix)
    const enrichedCart = {
      ...data.cart,
      items: await enrichItemsWithProductImages(data.cart?.items || []),
    }

    return corsResponse(request, { ...data, cart: enrichedCart })
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
