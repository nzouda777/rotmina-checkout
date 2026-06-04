import { ShopifyOrderCreateData } from './types'

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-04'

/**
 * Parse a variant_id that may be a numeric string, a number, or a Shopify GID
 * (e.g. "gid://shopify/ProductVariant/47835853152557")
 */
function parseVariantId(raw: string | number | undefined): number | undefined {
  if (raw == null) return undefined
  const str = String(raw)
  // Extract numeric part (handles both plain numbers and GID format)
  const numericStr = str.replace(/\D/g, '')
  if (!numericStr) return undefined
  const parsed = Number(numericStr)
  if (isNaN(parsed) || parsed <= 0) return undefined
  return parsed
}

export async function createShopifyOrder({ session, customer, transactionId, giftCard }: ShopifyOrderCreateData) {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    throw new Error('Missing Shopify configuration in environment variables')
  }

  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders.json`

  // Build transactions array
  const transactions: any[] = []

  // If gift card was used as payment, add it as a separate transaction
  if (giftCard && giftCard.appliedAmount > 0) {
    transactions.push({
      kind: 'sale',
      status: 'success',
      amount: giftCard.appliedAmount,
      gateway: 'gift_card',
      authorization: `GC-${giftCard.code}`,
    })
  }

  // Main credit card transaction (remaining amount after gift card)
  const ccAmount = giftCard
    ? session.cart.total - giftCard.appliedAmount
    : session.cart.total

  if (ccAmount > 0) {
    transactions.push({
      kind: 'sale',
      status: 'success',
      amount: ccAmount,
      gateway: 'Tranzila',
      authorization: transactionId,
    })
  }

  // Build note
  let note = `Paid via custom checkout - Tranzila Ref: ${transactionId || 'N/A'}`
  if (giftCard && giftCard.appliedAmount > 0) {
    note += ` | Gift Card ${giftCard.code}: -${giftCard.appliedAmount} ${session.cart.currency}`
  }
  if (customer.nationalId) {
    note += ` | ID: ${customer.nationalId}`
  }

  // Build line items with safe variant_id parsing
  const lineItems = session.cart.items.map((item) => {
    // Map our Record<string, string> properties to Shopify's expected array of {name, value}
    let lineItemProperties: { name: string; value: string }[] | undefined
    if (item.properties && Object.keys(item.properties).length > 0) {
      lineItemProperties = Object.entries(item.properties).map(([name, value]) => ({
        name,
        value: String(value),
      }))
    }

    const variantId = parseVariantId(item.variant_id)

    return {
      ...(variantId ? { variant_id: variantId } : {}),
      quantity: item.quantity,
      price: String(item.price),
      title: item.title,
      ...(lineItemProperties ? { properties: lineItemProperties } : {}),
    }
  })

  const orderData = {
    order: {
      inventory_behaviour: 'bypass',
      line_items: lineItems,
      billing_address: {
        first_name: customer.firstName,
        last_name: customer.lastName,
        address1: customer.address,
        city: customer.city,
        zip: customer.postalCode,
        country: customer.country,
        phone: customer.phone,
      },
      shipping_address: {
        first_name: customer.firstName,
        last_name: customer.lastName,
        address1: customer.address,
        city: customer.city,
        zip: customer.postalCode,
        country: customer.country,
        phone: customer.phone,
      },
      email: customer.email,
      phone: customer.phone,
      financial_status: 'paid',
      currency: session.cart.currency,
      transactions: transactions.map(t => ({
        ...t,
        amount: String(t.amount)
      })),
      note: note + ` | Phone: ${customer.phone}`,
      tags: giftCard
        ? 'Custom Checkout, Tranzila, Gift Card Used'
        : 'Custom Checkout, Tranzila',
    },
  }

  console.log('[SHOPIFY] Creating order with payload:', JSON.stringify({
    endpoint,
    api_version: SHOPIFY_API_VERSION,
    line_items_count: lineItems.length,
    line_items: lineItems.map(li => ({ title: li.title, variant_id: li.variant_id, quantity: li.quantity, price: li.price })),
    transactions_count: transactions.length,
    currency: session.cart.currency,
    total: session.cart.total,
    customer_email: customer.email,
  }))

  if (!SHOPIFY_STORE_DOMAIN.endsWith('.myshopify.com')) {
    throw new Error(`SHOPIFY_STORE_DOMAIN must be a .myshopify.com domain (got: ${SHOPIFY_STORE_DOMAIN}). Custom domains cause POST→GET redirect and will return an orders list instead of creating an order.`)
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    },
    body: JSON.stringify(orderData),
  })

  if (!response.ok) {
    const errorText = await response.text()
    let errorData: any
    try { errorData = JSON.parse(errorText) } catch { errorData = errorText }
    console.error('[SHOPIFY] Order Creation Error:', {
      status: response.status,
      statusText: response.statusText,
      errors: errorData?.errors || errorData,
      payload_summary: {
        line_items: lineItems.map(li => ({ variant_id: li.variant_id, title: li.title })),
        total: session.cart.total,
        currency: session.cart.currency,
      }
    })
    throw new Error(`Failed to create Shopify order (${response.status}): ${JSON.stringify(errorData?.errors || errorData)}`)
  }

  const data = await response.json()
  console.log('[SHOPIFY] Response status:', response.status, response.statusText)
  if (!data.order) {
    console.error('[SHOPIFY] Unexpected response — no order key in body. Full response:', JSON.stringify(data).substring(0, 2000))
    throw new Error(`Shopify returned unexpected response (no order): ${JSON.stringify(data).substring(0, 500)}`)
  }
  console.log('[SHOPIFY] Order created successfully:', { id: data.order.id, name: data.order.name })
  return data.order
}

