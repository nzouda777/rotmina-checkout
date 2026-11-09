/**
 * Shopify orders showing a balance due because their discount was never sent.
 *
 * Until the fix in lib/shopify.ts, orders were created at full price without
 * the discount the customer actually got (Shopify cart code or checkout
 * coupon). Shopify then shows e.g. "500 ₪ outstanding" on an order that was
 * fully paid (#1086: paid 1240, total 1740).
 *
 * How it is fixed: a manual payment equal to the balance is recorded on the
 * order (orderCreateManualPayment), labelled with the discount code. The order
 * becomes fully paid; items and the HFD shipment are untouched; nothing is
 * charged and the customer is not notified. Trade-off: Shopify's sales reports
 * count that amount as received — the real books (Tranzila / Morning) are not
 * affected.
 *
 * Why not add the discount instead: an order edit makes Shopify recompute VAT
 * on the edited line — on #1086 it would have left 70.20 ₪ due instead of 0.
 * Why not "mark as paid": Shopify refuses it (canMarkAsPaid = false), these
 * orders are already flagged paid despite the balance.
 *
 * Safety: an order is only touched when its balance equals the discount
 * recorded on the payment session.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { shopifyGraphql } from './shopify-discounts'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Name of the Shopify manual payment method used to settle these balances. */
export const MANUAL_PAYMENT_METHOD_DEFAULT = 'Discount adjustment'

export interface OrderBalanceIssue {
  sessionId: string
  orderId: string
  orderName: string
  customerName: string
  createdAt: string
  currency: string
  orderTotal: number
  outstanding: number
  missingDiscount: number
  codes: string[]
  /** False when the balance does not match the session's discount — fix by hand. */
  fixable: boolean
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}

/** Discount the customer got on this session (Shopify cart + checkout coupon). */
function sessionDiscount(session: any): { amount: number; codes: string[] } {
  const shopify = session?.cart?.shopify_discount
  const coupon = session?.raw_response?._coupon
  const amount = round2((Number(shopify?.amount) || 0) + (Number(coupon?.appliedAmount) || 0))
  const codes = [
    ...((shopify?.codes || []) as { code: string }[]).map(c => c.code),
    ...(coupon?.code ? [String(coupon.code)] : []),
  ].filter(Boolean)
  return { amount, codes }
}

const orderGid = (id: string) => (id.startsWith('gid://') ? id : `gid://shopify/Order/${id}`)

/** Paid orders whose Shopify balance is not 0 although the customer used a discount. */
export async function findOrdersWithMissingDiscount(): Promise<OrderBalanceIssue[]> {
  const supabase = getSupabase()
  const { data: sessions, error } = await supabase
    .from('payment_sessions')
    .select('id, order_id, created_at, customer, cart, raw_response')
    .eq('status', 'paid')
    .not('order_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)

  const candidates = (sessions || []).filter(s => sessionDiscount(s).amount > 0 && /^\d+$/.test(String(s.order_id)))
  if (candidates.length === 0) return []

  const issues: OrderBalanceIssue[] = []
  for (let i = 0; i < candidates.length; i += 100) {
    const batch = candidates.slice(i, i + 100)
    const data: any = await shopifyGraphql(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order {
          id name cancelledAt
          totalOutstandingSet { shopMoney { amount currencyCode } }
          currentTotalPriceSet { shopMoney { amount } }
        } } }`,
      { ids: batch.map(s => orderGid(String(s.order_id))) }
    )
    for (const node of data?.nodes || []) {
      if (!node?.id || node.cancelledAt) continue
      const outstanding = round2(Number(node.totalOutstandingSet?.shopMoney?.amount) || 0)
      if (outstanding <= 0) continue
      const s = batch.find(b => orderGid(String(b.order_id)) === node.id)
      if (!s) continue
      const { amount, codes } = sessionDiscount(s)
      issues.push({
        sessionId: s.id,
        orderId: String(s.order_id),
        orderName: node.name,
        customerName: `${s.customer?.firstName || ''} ${s.customer?.lastName || ''}`.trim(),
        createdAt: s.created_at,
        currency: node.totalOutstandingSet?.shopMoney?.currencyCode || s.cart?.currency || 'ILS',
        orderTotal: round2(Number(node.currentTotalPriceSet?.shopMoney?.amount) || 0),
        outstanding,
        missingDiscount: amount,
        codes,
        fixable: Math.abs(outstanding - amount) < 0.01,
      })
    }
  }
  return issues
}

/**
 * Settle the balance of a session's Shopify order with a manual payment
 * labelled with the discount code. Throws a readable message when it cannot
 * be done safely.
 */
export async function fixOrderMissingDiscount(sessionId: string): Promise<{ orderName: string; outstanding: number }> {
  const supabase = getSupabase()
  const { data: session, error } = await supabase
    .from('payment_sessions').select('id, order_id, status, cart, raw_response').eq('id', sessionId).single()
  if (error || !session) throw new Error('Session not found')
  if (session.status !== 'paid' || !session.order_id) throw new Error('Session is not a paid order')

  const { amount: discount, codes } = sessionDiscount(session)
  if (discount <= 0) throw new Error('No discount recorded on this order')

  const order: any = (await shopifyGraphql(
    `query($id: ID!) { order(id: $id) { id name cancelledAt totalOutstandingSet { shopMoney { amount currencyCode } } } }`,
    { id: orderGid(String(session.order_id)) }
  ))?.order
  if (!order) throw new Error('Shopify order not found')
  if (order.cancelledAt) throw new Error('Order is cancelled')

  const outstanding = round2(Number(order.totalOutstandingSet?.shopMoney?.amount) || 0)
  const currency = order.totalOutstandingSet?.shopMoney?.currencyCode || 'ILS'
  if (outstanding <= 0) throw new Error('Order has no balance due')
  if (Math.abs(outstanding - discount) >= 0.01) {
    throw new Error(`Balance due (${outstanding}) does not match the discount (${discount}) — fix it by hand in Shopify`)
  }

  // - No `amount` argument: it is Shopify Plus only. Without it Shopify records
  //   the full outstanding balance — just checked to equal the missing discount.
  // - The payment method must exist in Shopify (Settings → Payments → Manual
  //   payment methods → custom method) under exactly this name.
  const methodName = process.env.SHOPIFY_MANUAL_PAYMENT_METHOD || MANUAL_PAYMENT_METHOD_DEFAULT
  const data: any = await shopifyGraphql(
    `mutation($id: ID!, $name: String) {
        orderCreateManualPayment(id: $id, paymentMethodName: $name) {
          order { name totalOutstandingSet { shopMoney { amount } } displayFinancialStatus }
          userErrors { field message } } }`,
    { id: order.id, name: methodName }
  )
  const errors = data?.orderCreateManualPayment?.userErrors || []
  if (errors.length) {
    const msg = errors.map((e: any) => e.message).join('; ')
    if (/payment provider is not configured/i.test(msg)) {
      throw new Error(`${msg} — create a manual payment method named "${methodName}" in Shopify (Settings → Payments → Manual payment methods → Create custom payment method), then retry`)
    }
    throw new Error(msg)
  }

  const updated = data?.orderCreateManualPayment?.order
  const remaining = round2(Number(updated?.totalOutstandingSet?.shopMoney?.amount) || 0)
  console.log(`[ORDER-BALANCE] ${updated?.name || order.name}: manual payment ${outstanding} ${currency} via "${methodName}" — outstanding now ${remaining}, status ${updated?.displayFinancialStatus}`)

  // Traceability: which discount this payment stands for (non-fatal)
  try {
    const tag = `Discount adjustment ${codes.join(' + ') || ''} -${outstanding} ${currency}`.replace(/\s+/g, ' ').trim()
    await shopifyGraphql(
      `mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`,
      { id: order.id, tags: [tag] }
    )
  } catch (err: any) {
    console.warn(`[ORDER-BALANCE] Could not tag ${order.name}:`, err?.message || err)
  }

  return { orderName: updated?.name || order.name, outstanding: remaining }
}
