// Single source of truth for payment currencies.
//
// The Tranzila terminal supports exactly two currencies: ILS (code 1) and
// USD (code 2). Any other display currency (EUR, CHF, CAD…) MUST be converted
// to USD before checkout — never silently mapped to another Tranzila code.
// Bug #2 (300 EUR charged as 300 ILS) came from `currency === 'USD' ? '2' : '1'`
// ternaries scattered across routes; every currency → Tranzila-code decision
// must go through this module instead.

export const PAYABLE_CURRENCIES = ['ILS', 'USD'] as const
export type PayableCurrency = (typeof PAYABLE_CURRENCIES)[number]

export const TRANZILA_CURRENCY_CODES: Record<PayableCurrency, string> = {
  ILS: '1',
  USD: '2',
}

export function isPayableCurrency(currency: string | undefined | null): boolean {
  return PAYABLE_CURRENCIES.includes(((currency || '') as string).toUpperCase() as PayableCurrency)
}

/** ILS stays ILS; every other currency is charged in USD. */
export function toPayableCurrency(currency: string | undefined | null): PayableCurrency {
  return (currency || 'ILS').toUpperCase() === 'ILS' ? 'ILS' : 'USD'
}

/**
 * Numeric Tranzila currency code for a cart currency.
 * Throws on non-payable currencies so a bad session can never reach Tranzila
 * with the wrong code — callers turn this into a 400, not a silent ILS charge.
 */
export function tranzilaCurrencyCode(currency: string | undefined | null): string {
  const normalized = ((currency || '') as string).toUpperCase() as PayableCurrency
  const code = TRANZILA_CURRENCY_CODES[normalized]
  if (!code) {
    throw new Error(
      `Unsupported payment currency "${currency}" — only ${PAYABLE_CURRENCIES.join(', ')} can be charged`
    )
  }
  return code
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
  if (from === 'USD' && to === 'ILS') return 3.75
  if (from === 'ILS' && to === 'USD') return 1 / 3.75
  if (from === 'EUR' && to === 'ILS') return 4.05
  if (from === 'EUR' && to === 'USD') return 1.08
  if (from === 'GBP' && to === 'ILS') return 4.75
  if (from === 'GBP' && to === 'USD') return 1.27
  if (from === 'CHF' && to === 'USD') return 1.1
  if (from === 'CAD' && to === 'USD') return 0.73
  if (from === 'AUD' && to === 'USD') return 0.65
  return 1
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
