import { createClient } from '@/lib/supabase/server'

export interface ShippingSettings {
  free_shipping_threshold_ils: number
  domestic_shipping_fee_ils: number
  international_shipping_pct: number
}

const DEFAULTS: ShippingSettings = {
  free_shipping_threshold_ils: 499,
  domestic_shipping_fee_ils: 30,
  international_shipping_pct: 20,
}

export async function getShippingSettings(): Promise<ShippingSettings> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('shipping_settings')
      .select('free_shipping_threshold_ils, domestic_shipping_fee_ils, international_shipping_pct')
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
    }
  } catch (err) {
    console.warn('[SHIPPING] Unexpected error loading shipping_settings — using defaults:', err)
    return DEFAULTS
  }
}
