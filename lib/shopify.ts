import { ShopifyOrderCreateData } from './types'
import { separateGiftCardItems } from './gift-card-utils'
import { toE164, COUNTRY_DEFAULT_DIAL } from './phone'
import { getStateName } from './states'

// ISO 3166-1 alpha-2 codes for the checkout's shipping-country dropdown.
// Sending country_code (not just the free-text country name) is what lets
// Shopify's shipping-carrier address check reliably match the country.
// "Europe" has no real ISO code — it's a catch-all zone in this checkout's
// country selector, not an actual shippable country.
const COUNTRY_ISO_CODES: Record<string, string> = {
  Israel: 'IL',
  'United States': 'US',
  Canada: 'CA',
  'United Kingdom': 'GB',
  Australia: 'AU',
  Switzerland: 'CH',
}

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

  // Determine if this is a digital-only (gift card) order — no physical shipping needed
  const { regularItems } = separateGiftCardItems(session.cart.items)
  const isGiftCardOnly = regularItems.length === 0 && session.cart.items.length > 0

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

  // Normalize the phone to E.164. If it cannot be normalized safely, omit it
  // from the address — the raw value stays in the note. A missing phone must
  // never block order creation (the customer has already been charged).
  const normalizedPhone = toE164(customer.phone, COUNTRY_DEFAULT_DIAL[customer.country])
  if (customer.phone && !normalizedPhone) {
    console.warn(`[SHOPIFY] Phone "${customer.phone}" could not be normalized to E.164 — omitting from address (kept in note)`)
  }

  const shippingAddress = {
    first_name: customer.firstName,
    last_name: customer.lastName,
    address1: customer.address,
    city: customer.city,
    zip: customer.postalCode,
    country: customer.country,
    ...(COUNTRY_ISO_CODES[customer.country] ? { country_code: COUNTRY_ISO_CODES[customer.country] } : {}),
    // Required by Shopify's shipping-carrier address check for countries that
    // have states/provinces (US, CA, AU, CH) — a missing one is exactly what
    // gets an otherwise-correct address flagged "Review address issues".
    ...(customer.province
      ? { province: getStateName(customer.country, customer.province), province_code: customer.province }
      : {}),
    ...(normalizedPhone ? { phone: normalizedPhone } : {}),
  }

  // Build order tags — gift card-only orders get a "No Shipping" tag so HFD
  // fulfillment can be configured to skip them automatically.
  let orderTags = 'Custom Checkout, Tranzila'
  if (isGiftCardOnly) {
    orderTags += ', Digital Product, Gift Card, No Shipping'
  } else if (giftCard) {
    orderTags += ', Gift Card Used'
  }

  // Carrier: HFD for Israel, Shipping2go for all other countries
  const isIsrael =
    customer.country === 'Israel' ||
    customer.country === 'IL' ||
    customer.country?.toLowerCase() === 'israel'

  const shippingLines = isGiftCardOnly
    ? []
    : [
        {
          title: isIsrael ? 'HFD' : 'Shipping2go',
          code: isIsrael ? 'HFD' : 'Shipping2go',
          price: String(session.cart.shipping ?? 0),
        },
      ]

  const orderData = {
    order: {
      inventory_behaviour: 'bypass',
      line_items: lineItems,
      billing_address: shippingAddress,
      // Omit shipping_address for digital-only orders to prevent HFD from
      // creating a physical shipment for a gift card.
      ...(isGiftCardOnly ? {} : { shipping_address: shippingAddress }),
      ...(shippingLines.length > 0 ? { shipping_lines: shippingLines } : {}),
      email: customer.email,
      // Deliberately no top-level `phone`: Shopify validates it far more
      // strictly than address phones (E.164 + uniqueness across customers)
      // and rejects the whole order on mismatch. The phone lives on the
      // shipping/billing address and in the note instead.
      financial_status: 'paid',
      currency: session.cart.currency,
      transactions: transactions.map(t => ({
        ...t,
        amount: String(t.amount)
      })),
      note: note + ` | Phone: ${customer.phone}`,
      tags: orderTags,
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

  const postOrder = async (payload: any) =>
    fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      },
      body: JSON.stringify(payload),
    })

  let response = await postOrder(orderData)

  // Last line of defense: if Shopify still rejects the phone, retry once with
  // all phone fields stripped. Losing the phone on the address is acceptable;
  // losing the order after a successful charge is not.
  if (!response.ok && response.status === 422) {
    const firstErrorText = await response.text()
    if (/phone/i.test(firstErrorText)) {
      console.warn(`[SHOPIFY] Order rejected because of phone (${firstErrorText}) — retrying without phone fields`)
      const strippedAddress: any = { ...shippingAddress }
      delete strippedAddress.phone
      const retryData = {
        order: {
          ...orderData.order,
          billing_address: strippedAddress,
          ...(isGiftCardOnly ? {} : { shipping_address: strippedAddress }),
        },
      }
      response = await postOrder(retryData)
    } else {
      // Not a phone problem — rebuild the response so the error handling
      // below can consume the body normally.
      response = new Response(firstErrorText, { status: 422, statusText: 'Unprocessable Entity' }) as any
    }
  }

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

