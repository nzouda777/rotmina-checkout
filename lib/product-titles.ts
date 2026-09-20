/**
 * Localized product titles for the Morning receipt.
 *
 * Cart items carry whatever title Shopify's /cart.js handed back when the
 * customer clicked through — the storefront's own locale at that moment, not
 * the language the receipt ends up being issued in. The two drift apart all
 * the time: /cart.js is fetched from the root path (so it answers in the
 * market's default language whatever page the button sat on), and the customer
 * can still switch the checkout language afterwards.
 *
 * So the titles are re-resolved here, against the storefront's own localized
 * product JSON — the same source the shop itself renders from:
 *   https://rotmina.com/products/<handle>.js      → Hebrew (root market)
 *   https://rotmina.com/en/products/<handle>.js   → English
 * Same prefix rule as storeUrl() in lib/store-url.ts.
 *
 * The Admin API is no help here: it only ever returns the primary-locale title
 * (this store's products read English there while the storefront shows
 * Hebrew), and the translations API needs a `read_translations` scope the
 * checkout's access token doesn't have.
 *
 * The endpoint is public — no auth, no token. Every failure falls back to the
 * cart title: a receipt with the wrong-language product name still beats no
 * receipt, and the receipt is issued from `after()` on a paid order.
 */

const STORE_BASE = (process.env.NEXT_PUBLIC_STORE_URL || 'https://rotmina.com').replace(/\/$/, '')

const FETCH_TIMEOUT_MS = 5_000
const CACHE_TTL_MS = 10 * 60 * 1000

// Module-level cache: warm across invocations that land on the same serverless
// instance, and — more to the point — collapses repeat lookups inside one cart.
const titleCache = new Map<string, { title: string; expiresAt: number }>()

export interface LocalizedItem {
  description: string
  quantity: number
  price: number
}

/**
 * Pull the product handle off a cart item. Sessions created before handles
 * were stored only carry `url` (e.g. "/products/foo?variant=123").
 */
function getHandle(item: any): string | null {
  if (item?.handle) return String(item.handle)
  const match = String(item?.url || '').match(/\/products\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

async function fetchLocalizedTitle(handle: string, lang: 'he' | 'en'): Promise<string | null> {
  const cacheKey = `${lang}:${handle}`
  const cached = titleCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) return cached.title

  const prefix = lang === 'he' ? '' : '/en'
  const url = `${STORE_BASE}${prefix}/products/${encodeURIComponent(handle)}.js`

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`[TITLES] ${url} → ${res.status} — keeping cart title`)
      return null
    }
    const data = await res.json()
    const title = typeof data?.title === 'string' && data.title.trim() ? data.title.trim() : null
    if (!title) {
      console.warn(`[TITLES] ${url} returned no title — keeping cart title`)
      return null
    }
    titleCache.set(cacheKey, { title, expiresAt: Date.now() + CACHE_TTL_MS })
    return title
  } catch (err: any) {
    console.warn(`[TITLES] ${url} failed (${err?.message || err}) — keeping cart title`)
    return null
  }
}

/**
 * Build the Morning `items` array with each product name resolved in `lang`.
 *
 * One storefront request per distinct product, all in parallel; never rejects.
 */
export async function buildLocalizedReceiptItems(
  cartItems: any[],
  lang: 'he' | 'en'
): Promise<LocalizedItem[]> {
  const items = cartItems || []
  if (items.length === 0) return []

  const handles = [...new Set(items.map(getHandle).filter(Boolean) as string[])]

  const resolved = new Map<string, string>()
  await Promise.all(
    handles.map(async handle => {
      const title = await fetchLocalizedTitle(handle, lang)
      if (title) resolved.set(handle, title)
    })
  )

  return items.map((item: any) => {
    const handle = getHandle(item)
    const localized = handle ? resolved.get(handle) : undefined
    return {
      description: localized || item.title,
      quantity: item.quantity,
      price: Number(item.price),
    }
  })
}
