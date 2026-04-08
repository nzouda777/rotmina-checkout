import { ShopifyOrderCreateData } from './types'

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-04'

export async function createShopifyOrder({ session, customer, transactionId }: ShopifyOrderCreateData) {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    throw new Error('Missing Shopify configuration in environment variables')
  }

  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders.json`

  const orderData = {
    order: {
      line_items: session.cart.items.map((item) => ({
        variant_id: item.variant_id ? parseInt(String(item.variant_id)) : undefined,
        quantity: item.quantity,
        price: item.price,
        title: item.title,
      })),
      customer: {
        first_name: customer.firstName,
        last_name: customer.lastName,
        email: customer.email,
      },
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
      total_price: session.cart.total,
      transactions: [
        {
          kind: 'sale',
          status: 'success',
          amount: session.cart.total,
          gateway: 'Tranzila',
          authorization: transactionId,
        },
      ],
      note: `Paid via custom checkout - Tranzila Ref: ${transactionId || 'N/A'}`,
      tags: 'Custom Checkout, Tranzila',
    },
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    },
    body: JSON.stringify(orderData),
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error('Shopify Order Creation Error:', errorData)
    throw new Error(`Failed to create Shopify order: ${JSON.stringify(errorData.errors)}`)
  }

  const data = await response.json()
  return data.order
}
