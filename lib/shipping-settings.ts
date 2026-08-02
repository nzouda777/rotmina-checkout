import { createClient } from '@/lib/supabase/server'

export interface ShippingSettings {
  free_shipping_threshold_ils: number
  domestic_shipping_fee_ils: number
  international_shipping_pct: number
  en_shipping_fee_usd: number
}

const DEFAULTS: ShippingSettings = {
  free_shipping_threshold_ils: 499,
  domestic_shipping_fee_ils: 30,
  international_shipping_pct: 20,
  en_shipping_fee_usd: 50,
}

/**
 * The only country that ships domestically. Everything else is international.
 *
 * Country names are the full labels captured by the address form (see
 * COUNTRY_STATES / the country <select> in components/checkout/customer-form.tsx),
 * not ISO codes.
 */
export const DOMESTIC_COUNTRY = 'Israel'

export interface ShippingFeeInput {
  cfg: ShippingSettings
  /**
   * Shipping country from the address form. Null before the customer has
   * reached that step — at session creation there is no address yet, so the
   * checkout language stands in as the provisional market.
   */
  country: string | null
  /** Checkout language, used only as the fallback market when `country` is null. */
  language: 'en' | 'he'
  /** Cart subtotal in the CART's own currency, before any Shopify discount. */
  displayedSubtotal: number
  isGiftCardOnlyCart: boolean
  /** ILS → cart currency (exactly 1 when the cart is already in ILS). */
  ilsToCart: number
  /** USD → cart currency (exactly 1 when the cart is already in USD). */
  usdToCart: number
}

/**
 * Single source of truth for the shipping fee, returned in the cart's currency.
 *
 * Every place that touches shipping goes through here — session creation, the
 * apply-tax PATCH once the country is known, and the remove-item PATCH. They
 * used to each decide independently, and disagreed: session creation keyed the
 * policy on the checkout language while remove-item keyed it on the cart
 * currency, so an English cart denominated in ILS was charged the international
 * fee at creation and then silently dropped to the Israeli domestic rules as
 * soon as the customer removed a line item.
 *
 * The fee is derived in the currency it is configured in and converted once,
 * never round-tripped: a USD-configured international fee is exact for a USD
 * cart, an ILS-configured domestic fee is exact for an ILS cart.
 */
export function computeShippingFee({
  cfg,
  country,
  language,
  displayedSubtotal,
  isGiftCardOnlyCart,
  ilsToCart,
  usdToCart,
}: ShippingFeeInput): number {
  // Gift card-only orders are digital — nothing to ship.
  if (isGiftCardOnlyCart) return 0

  const round2 = (n: number) => Math.round(n * 100) / 100
  const isDomestic = country ? country === DOMESTIC_COUNTRY : language === 'he'

  if (isDomestic) {
    // Threshold and fee are both configured in ILS, so convert them into the
    // cart's currency rather than converting the subtotal back into ILS —
    // otherwise a 499 ILS threshold would read as 499 EUR.
    const threshold = cfg.free_shipping_threshold_ils * ilsToCart
    return displayedSubtotal >= threshold ? 0 : round2(cfg.domestic_shipping_fee_ils * ilsToCart)
  }

  return round2(cfg.en_shipping_fee_usd * usdToCart)
}

export async function getShippingSettings(): Promise<ShippingSettings> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('shipping_settings')
      .select('free_shipping_threshold_ils, domestic_shipping_fee_ils, international_shipping_pct, en_shipping_fee_usd')
      .eq('id', 1)
      .single()

    if (error || !data) {
      console.warn('[SHIPPING] Could not load shipping_settings from DB — using defaults:', error?.message)
      return DEFAULTS
    }

    return {
      free_shipping_threshold_ils: Number(data.free_shipping_threshold_ils),
      domestic_shipping_fee_ils: Number(data.domestic_shipping_fee_ils),
      international_shipping_pct: Number(data.international_shipping_pct),
      en_shipping_fee_usd: data.en_shipping_fee_usd != null ? Number(data.en_shipping_fee_usd) : DEFAULTS.en_shipping_fee_usd,
    }
  } catch (err) {
    console.warn('[SHIPPING] Unexpected error loading shipping_settings — using defaults:', err)
    return DEFAULTS
  }
}
