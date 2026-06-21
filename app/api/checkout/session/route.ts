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
      cart,
      customer: bodyCustomer,
      shopify_discount: bodyShopifyDiscount,
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

      // Log the FULL cart object keys so we can see every field Shopify sends
      console.log(`[DISCOUNT] Full cart keys: ${Object.keys(cart).join(', ')}`)
      console.log(`[DISCOUNT] Raw cart discount fields:`, JSON.stringify({
        total_discount: cart.total_discount,
        discount_codes: cart.discount_codes,
        discounts: cart.discounts,
        cart_level_discount_applications: cart.cart_level_discount_applications,
        original_total_price: cart.original_total_price,
        total_price: cart.total_price,
        items_subtotal_price: cart.items_subtotal_price,
      }))

      // --- Discount detection (all known Shopify mechanisms) ---
      // 1. Explicit discount_codes / discounts array (manual codes added to cart)
      const rawDiscountCodes: { code: string; amount: string; type: string }[] =
        cart.discount_codes || cart.discounts || []

      // 2. cart_level_discount_applications (automatic discounts + script discounts)
      const cartLevelApps: any[] = cart.cart_level_discount_applications || []

      // 3. original_total_price vs total_price — most reliable: covers everything
      const originalTotal = Number(cart.original_total_price || 0)
      const currentTotal  = Number(cart.total_price || 0)
      const priceDropDiscount = originalTotal > 0 && originalTotal > currentTotal
        ? originalTotal - currentTotal
        : 0

      // 4. explicit total_discount field
      const explicitDiscount = Number(cart.total_discount || 0)

      // Combine: any signal means a discount is active
      const shopifyDiscountAmountCents = explicitDiscount || priceDropDiscount
      const hasShopifyDiscount = shopifyDiscountAmountCents > 0 || rawDiscountCodes.length > 0 || cartLevelApps.length > 0

      // Build codes: prefer cart_level_discount_applications (has title + amount + value_type).
      // Newer Shopify carts put only { code, applicable } in discount_codes with no amount/type.
      let shopifyDiscountCodes: { code: string; amount: string; type: string }[]
      if (cartLevelApps.length > 0) {
        shopifyDiscountCodes = cartLevelApps.map((app: any) => ({
          code: app.title || (rawDiscountCodes[0] as any)?.code || '',
          amount: String((app.total_allocated_amount || shopifyDiscountAmountCents) / 100),
          type: app.value_type || 'fixed_amount',
        }))
      } else {
        shopifyDiscountCodes = (rawDiscountCodes as any[])
          .filter((dc) => dc.code)
          .map((dc) => ({
            code: dc.code || '',
            amount: String(shopifyDiscountAmountCents / 100),
            type: dc.type || 'fixed_amount',
          }))
      }

      console.log(`[DISCOUNT] hasShopifyDiscount=${hasShopifyDiscount} amountCents=${shopifyDiscountAmountCents} codes=${JSON.stringify(shopifyDiscountCodes)}`)

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
        currency: 'ILS',
        ...(hasShopifyDiscount
          ? {
              shopify_discount: {
                amount: Math.round((shopifyDiscountAmountCents / 100) * rate * 100) / 100,
                codes: shopifyDiscountCodes,
              },
            }
          : {}),
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

    // For pre-formatted carts, detect discount from any known field
    if (finalCart && !finalCart.shopify_discount) {
      const preDiscountCodes: { code: string; amount: string; type: string }[] =
        finalCart.discount_codes || finalCart.discounts || []
      const preDiscountAmount = Number(finalCart.total_discount || 0)
      const preCartApps: any[] = finalCart.cart_level_discount_applications || []
      const preOriginal = Number(finalCart.original_total_price || 0)
      const preCurrent  = Number(finalCart.total || 0)
      const prePriceDrop = preOriginal > 0 && preOriginal > preCurrent ? preOriginal - preCurrent : 0
      const preTotalDiscount = preDiscountAmount || prePriceDrop

      let allPreCodes: { code: string; amount: string; type: string }[]
      if (preCartApps.length > 0) {
        allPreCodes = preCartApps.map((app: any) => ({
          code: app.title || (preDiscountCodes[0] as any)?.code || '',
          amount: String((app.total_allocated_amount || preTotalDiscount) / 100),
          type: app.value_type || 'fixed_amount',
        }))
      } else {
        allPreCodes = (preDiscountCodes as any[])
          .filter((dc) => dc.code)
          .map((dc) => ({
            code: dc.code || '',
            amount: String(preTotalDiscount / 100),
            type: dc.type || 'fixed_amount',
          }))
      }
      if (preTotalDiscount > 0 || allPreCodes.length > 0) {
        console.log(`[DISCOUNT] Pre-formatted cart discount detected: amount=${preTotalDiscount} codes=${JSON.stringify(allPreCodes)}`)
        finalCart.shopify_discount = { amount: preTotalDiscount, codes: allPreCodes }
      }
    }

    // If the client (Shopify script) passed discount info, merge it in.
    // We always apply client codes when they have richer data (code + amount + type from
    // cart_level_discount_applications). Amount falls back to server detection if zero.
    if (bodyShopifyDiscount) {
      const clientAmountILS = Math.round((bodyShopifyDiscount.amountCents / 100) * rate * 100) / 100
      const clientCodes: { code: string; amount: string; type: string }[] = bodyShopifyDiscount.codes || []
      const hasRicherCodes = clientCodes.length > 0 && clientCodes[0].amount && clientCodes[0].type
      if (!finalCart.shopify_discount) {
        if (clientAmountILS > 0 || clientCodes.length > 0) {
          finalCart.shopify_discount = { amount: clientAmountILS, codes: clientCodes }
          console.log(`[DISCOUNT] Set from client-provided discount: amount=${clientAmountILS}`)
        }
      } else if (hasRicherCodes) {
        // Server set the discount but client has richer codes — replace just the codes
        finalCart.shopify_discount = { ...finalCart.shopify_discount, codes: clientCodes }
        console.log(`[DISCOUNT] Enriched server discount codes with client data`)
      }
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

    console.log(`[SESSION] Final cart shopify_discount before INSERT:`, JSON.stringify(finalCart.shopify_discount ?? null))
    console.log(`[SESSION] Final cart total: ${finalCart.total} | subtotal: ${finalCart.subtotal}`)

    const supabase = await createClient()
    const orderId = randomInt(0, 9999) 

    const insertPayload: Record<string, any> = {
      shop,
      order_id: orderId,
      idempotency_key: idempotencyKey,
      cart: finalCart,
      amount: finalCart.total,
      currency: finalCart.currency || 'ILS',
      status: 'pending',
    }
    if (bodyCustomer) insertPayload.customer = bodyCustomer

    const { data, error } = await supabase
      .from('payment_sessions')
      .insert(insertPayload)
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
