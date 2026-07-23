// Single source of truth for payment currencies.
//
// Tranzila's v1 API (Hosted Fields SDK + REST "create" endpoint) charges
// directly in ISO 4217 alphabetic currency codes — ILS, USD, EUR, GBP, CAD,
// CHF, etc — per https://docs.tranzila.com. These are the currencies actually
// offered in the checkout's currency selector (see CURRENCIES in
// lib/language-context.tsx); whichever one the customer selects is the one
// that gets charged and the one the Shopify order is created in.
//
// Bit is the one exception: it's an Israeli mobile-payment method that only
// ever settles in ILS, regardless of this list — that restriction is enforced
// separately in app/api/checkout/charge/route.ts and is unrelated to card
// charges going through this module.

export const PAYABLE_CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD'] as const
export type PayableCurrency = (typeof PAYABLE_CURRENCIES)[number]

export function isPayableCurrency(currency: string | undefined | null): boolean {
  return PAYABLE_CURRENCIES.includes(((currency || '') as string).toUpperCase() as PayableCurrency)
}

/** Any supported currency passes through unchanged; anything unrecognized falls back to USD. */
export function toPayableCurrency(currency: string | undefined | null): PayableCurrency {
  const normalized = (currency || 'ILS').toUpperCase()
  return isPayableCurrency(normalized) ? (normalized as PayableCurrency) : 'USD'
}

// ─── Bit-only legacy numeric codes ──────────────────────────────────────────
// Bit payments are hard-restricted to ILS (see the guard in charge/route.ts),
// and Tranzila's legacy Bit REST/handshake calls historically used numeric
// currency codes. Kept separate from the ISO codes above so widening
// PAYABLE_CURRENCIES for card charges doesn't imply numeric codes exist for
// the other currencies (they don't — Bit never charges them).
const BIT_LEGACY_NUMERIC_CODES: Record<'ILS' | 'USD', string> = {
  ILS: '1',
  USD: '2',
}

/**
 * Legacy numeric Tranzila currency code — used only for Bit's handshake/REST
 * calls. Throws for anything besides ILS/USD (Bit never reaches this with
 * another currency; the guard in charge/route.ts blocks it first).
 */
export function tranzilaCurrencyCode(currency: string | undefined | null): string {
  const normalized = ((currency || '') as string).toUpperCase()
  const code = BIT_LEGACY_NUMERIC_CODES[normalized as 'ILS' | 'USD']
  if (!code) {
    throw new Error(`Unsupported Bit currency "${currency}" — only ILS/USD have legacy numeric codes`)
  }
  return code
}

/**
 * ISO 4217 currency code for a real card charge via Tranzila's v1 API, which
 * takes alphabetic codes directly. Throws on anything not in PAYABLE_CURRENCIES
 * so a bad session can never reach Tranzila with an unsupported currency —
 * callers turn this into a 400, not a silent mischarge.
 */
export function tranzilaChargeCurrency(currency: string | undefined | null): PayableCurrency {
  const normalized = ((currency || '') as string).toUpperCase()
  if (!isPayableCurrency(normalized)) {
    throw new Error(
      `Unsupported payment currency "${currency}" — only ${PAYABLE_CURRENCIES.join(', ')} can be charged`
    )
  }
  return normalized as PayableCurrency
}

// Approximate USD value of one unit of each currency — used only when the
// live rate API below is unreachable, to derive a fallback cross rate for
// any pair (e.g. EUR→CHF), not just a few hardcoded directions.
const APPROX_USD_VALUE: Record<string, number> = {
  USD: 1,
  ILS: 1 / 3.75,
  EUR: 1.08,
  GBP: 1.27,
  CHF: 1.1,
  CAD: 0.73,
  AUD: 0.65,
}

export async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
      next: { revalidate: 3600 },
    })
    const data = await res.json()
    if (data?.rates?.[to]) return data.rates[to]
  } catch (e) {
    console.warn('[CURRENCY] Failed to fetch live exchange rate, using fallback')
  }
  if (APPROX_USD_VALUE[from] && APPROX_USD_VALUE[to]) {
    return APPROX_USD_VALUE[from] / APPROX_USD_VALUE[to]
  }
  return 1
}

/**
 * Append `?currency=`/`&currency=` to a URL so the destination (e.g. the
 * Shopify storefront or order status page) can read the checkout's currency
 * and react to it (pricing display, analytics, etc).
 */
export function withCurrencyParam(url: string, currency: string | undefined | null): string {
  if (!url || !currency) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}currency=${encodeURIComponent(currency)}`
}

/** Convert every monetary field of a session cart to `targetCurrency`. */
export function convertCart(cart: any, targetCurrency: string, rate: number): any {
  const round = (n: number) => Math.round((n || 0) * rate * 100) / 100
  const convertedSubtotal = round(cart.subtotal)
  const convertedShipping = round(cart.shipping)
  const convertedTax = round(cart.tax)
  return {
    ...cart,
    currency: targetCurrency,
    items: ((cart.items || []) as any[]).map((item: any) => ({
      ...item,
      price: round(item.price),
    })),
    subtotal: convertedSubtotal,
    shipping: convertedShipping,
    tax: convertedTax,
    total: Math.round((convertedSubtotal + convertedShipping + convertedTax) * 100) / 100,
    ...(cart.shopify_discount
      ? { shopify_discount: { ...cart.shopify_discount, amount: round(cart.shopify_discount.amount) } }
      : {}),
  }
}
