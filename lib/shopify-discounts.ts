/**
 * Shopify discount codes ↔ coupon_codes.
 *
 * Discount codes created in the Shopify admin are mirrored into coupon_codes
 * (source = 'shopify', see scripts/012_shopify_discount_sync.sql) so that:
 *   - they show up in the Rotmina admin next to the local coupons;
 *   - customers can type them in this checkout, not only in the Shopify cart;
 *   - their usage is counted when an order is paid here, and once the usage
 *     limit is reached the code is deactivated in Shopify too.
 *
 * Why the deactivation: orders are created through the Admin API, and Shopify
 * does not enforce (nor reliably count) discount-code usage for API orders —
 * a single-use code stayed ACTIVE with asyncUsageCount 0 after being used.
 *
 * Only "simple" codes can be typed in this checkout (amount or percentage on
 * the whole order, no minimum, any customer, not once-per-customer). Others are
 * still mirrored and counted, but must be applied in the Shopify cart, where
 * Shopify itself checks their conditions.
 */

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-04'

export interface ShopifyCodeDiscount {
  id: string                 // gid://shopify/DiscountCodeNode/…
  kind: string               // DiscountCodeBasic | DiscountCodeFreeShipping | DiscountCodeBxgy | DiscountCodeApp
  title: string
  status: string             // ACTIVE | EXPIRED | SCHEDULED
  usageCount: number
  usageLimit: number | null
  codes: string[]
  startsAt: string | null
  endsAt: string | null
  valueType: 'amount' | 'percentage' | null
  value: number              // amount, or percentage 0–100
  currency: string | null
  /** True when the code can be applied by this checkout (see header). */
  checkoutUsable: boolean
}

// ── GraphQL ────────────────────────────────────────────────────────────────────

const NODE_FIELDS = `
  id
  codeDiscount {
    __typename
    ... on DiscountCodeBasic {
      title status asyncUsageCount usageLimit appliesOncePerCustomer startsAt endsAt
      context { __typename }
      codes(first: 20) { nodes { code } }
      minimumRequirement { __typename }
      customerGets {
        value {
          __typename
          ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
          ... on DiscountPercentage { percentage }
        }
        items { __typename }
      }
    }
    ... on DiscountCodeFreeShipping { title status asyncUsageCount usageLimit startsAt endsAt codes(first: 20) { nodes { code } } }
    ... on DiscountCodeBxgy { title status asyncUsageCount usageLimit startsAt endsAt codes(first: 20) { nodes { code } } }
    ... on DiscountCodeApp { title status asyncUsageCount usageLimit startsAt endsAt codes(first: 20) { nodes { code } } }
  }`

export async function shopifyGraphql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    throw new Error('Missing Shopify configuration in environment variables')
  }
  const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json || json.errors) {
    throw new Error(`Shopify GraphQL error (${res.status}): ${JSON.stringify(json?.errors || json).slice(0, 500)}`)
  }
  return json.data as T
}

function parseNode(node: any): ShopifyCodeDiscount | null {
  const d = node?.codeDiscount
  if (!node?.id || !d) return null

  const kind = String(d.__typename || 'Unknown')
  let valueType: ShopifyCodeDiscount['valueType'] = null
  let value = 0
  let currency: string | null = null
  let checkoutUsable = false

  if (kind === 'DiscountCodeBasic') {
    const v = d.customerGets?.value
    if (v?.__typename === 'DiscountAmount') {
      valueType = 'amount'
      value = Number(v.amount?.amount) || 0
      currency = v.amount?.currencyCode || null
    } else if (v?.__typename === 'DiscountPercentage') {
      valueType = 'percentage'
      value = Math.round((Number(v.percentage) || 0) * 10000) / 100 // 0.2 → 20
    }
    checkoutUsable =
      valueType !== null &&
      value > 0 &&
      d.customerGets?.items?.__typename === 'AllDiscountItems' &&
      !d.minimumRequirement &&
      !d.appliesOncePerCustomer &&
      !(valueType === 'amount' && d.customerGets?.value?.appliesOnEachItem) &&
      (!d.context || d.context.__typename === 'DiscountBuyerSelectionAll')
  }

  return {
    id: node.id,
    kind,
    title: d.title || '',
    status: d.status || 'EXPIRED',
    usageCount: Number(d.asyncUsageCount) || 0,
    usageLimit: d.usageLimit != null ? Number(d.usageLimit) : null,
    codes: (d.codes?.nodes || []).map((c: any) => String(c.code)).filter(Boolean),
    startsAt: d.startsAt || null,
    endsAt: d.endsAt || null,
    valueType,
    value,
    currency,
    checkoutUsable,
  }
}

/** Look up one code in Shopify (case-insensitive). Null if it does not exist. */
export async function lookupShopifyDiscountCode(code: string): Promise<ShopifyCodeDiscount | null> {
  const data = await shopifyGraphql(
    `query($code: String!) { codeDiscountNodeByCode(code: $code) { ${NODE_FIELDS} } }`,
    { code: code.trim() }
  )
  return parseNode(data?.codeDiscountNodeByCode)
}

/** All code discounts of the store. */
export async function fetchAllShopifyDiscountCodes(): Promise<ShopifyCodeDiscount[]> {
  const out: ShopifyCodeDiscount[] = []
  let after: string | null = null
  for (let page = 0; page < 20; page++) {
    const data: any = await shopifyGraphql(
      `query($after: String) { codeDiscountNodes(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${NODE_FIELDS} } } }`,
      { after }
    )
    for (const node of data?.codeDiscountNodes?.nodes || []) {
      const parsed = parseNode(node)
      if (parsed) out.push(parsed)
    }
    if (!data?.codeDiscountNodes?.pageInfo?.hasNextPage) break
    after = data.codeDiscountNodes.pageInfo.endCursor
  }
  return out
}

export async function setShopifyDiscountActive(discountId: string, active: boolean): Promise<void> {
  const mutation = active ? 'discountCodeActivate' : 'discountCodeDeactivate'
  const data: any = await shopifyGraphql(
    `mutation($id: ID!) { ${mutation}(id: $id) { userErrors { field message } } }`,
    { id: discountId }
  )
  const errors = data?.[mutation]?.userErrors || []
  if (errors.length > 0) throw new Error(`${mutation} failed: ${JSON.stringify(errors)}`)
}

// ── Mirror into coupon_codes ───────────────────────────────────────────────────

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}

export const normalizeCode = (code: string) => code.trim().toUpperCase()

/** Row values for one code of a Shopify discount, merged with the existing row. */
function toCouponRow(discount: ShopifyCodeDiscount, code: string, existing: any | null) {
  const currentUses = Math.max(Number(existing?.current_uses) || 0, discount.usageCount)
  const limitReached = discount.usageLimit != null && currentUses >= discount.usageLimit
  const status = limitReached ? 'depleted' : discount.status === 'ACTIVE' ? 'active' : 'disabled'
  return {
    code: normalizeCode(code),
    source: 'shopify',
    shopify_discount_id: discount.id,
    shopify_title: discount.title,
    shopify_kind: discount.kind,
    checkout_usable: discount.checkoutUsable,
    // coupon_codes only knows amount/percentage — other kinds are stored as a
    // 0-amount row (mirrored for usage tracking, never applied by this checkout)
    discount_type: discount.valueType || 'amount',
    discount_value: discount.valueType ? discount.value : 0,
    currency: discount.currency || existing?.currency || 'ILS',
    status,
    max_uses: discount.usageLimit,
    current_uses: currentUses,
    starts_at: discount.startsAt,
    ends_at: discount.endsAt,
    synced_at: new Date().toISOString(),
    applies_to_all: true,
    allowed_variant_ids: [],
    ...(existing ? {} : { note: `Shopify: ${discount.title}` }),
  }
}

export interface SyncResult {
  synced: number
  conflicts: string[]   // codes that already exist as local coupons — left untouched
  removed: number       // mirrored codes no longer in Shopify — disabled
}

/** Mirror one discount (all its codes). Returns codes skipped because a local coupon owns them. */
export async function upsertShopifyDiscount(discount: ShopifyCodeDiscount, supabase = getSupabase()): Promise<string[]> {
  const conflicts: string[] = []
  for (const code of discount.codes) {
    const normalized = normalizeCode(code)
    const { data: existing, error: readError } = await supabase
      .from('coupon_codes').select('*').eq('code', normalized).maybeSingle()
    if (readError) throw new Error(readError.message)

    if (existing && existing.source !== 'shopify') { conflicts.push(normalized); continue }

    const row = toCouponRow(discount, code, existing)
    const { error } = existing
      ? await supabase.from('coupon_codes').update(row).eq('id', existing.id)
      : await supabase.from('coupon_codes').insert(row)
    if (error) throw new Error(error.message)
  }
  return conflicts
}

export async function syncShopifyDiscounts(): Promise<SyncResult> {
  const supabase = getSupabase()
  const discounts = await fetchAllShopifyDiscountCodes()
  const result: SyncResult = { synced: 0, conflicts: [], removed: 0 }
  const seenCodes = new Set<string>()

  for (const discount of discounts) {
    result.conflicts.push(...await upsertShopifyDiscount(discount, supabase))
    discount.codes.forEach(c => seenCodes.add(normalizeCode(c)))
    result.synced += discount.codes.length
  }

  // Codes deleted in Shopify → disable the mirror (keep the row for history)
  const { data: mirrored } = await supabase
    .from('coupon_codes').select('id, code, status').eq('source', 'shopify')
  for (const row of mirrored || []) {
    if (!seenCodes.has(row.code) && row.status === 'active') {
      await supabase.from('coupon_codes')
        .update({ status: 'disabled', checkout_usable: false, synced_at: new Date().toISOString() })
        .eq('id', row.id)
      result.removed++
    }
  }

  result.synced -= result.conflicts.length
  return result
}
