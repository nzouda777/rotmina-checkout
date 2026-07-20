import { createClient } from '@/lib/supabase/server'

export interface CheckoutSettings {
  returning_customer_autofill_enabled: boolean
}

const DEFAULTS: CheckoutSettings = {
  returning_customer_autofill_enabled: false,
}

export async function getCheckoutSettings(): Promise<CheckoutSettings> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('checkout_settings')
      .select('returning_customer_autofill_enabled')
      .eq('id', 1)
      .single()

    if (error || !data) {
      console.warn('[CHECKOUT-SETTINGS] Could not load checkout_settings from DB — using defaults:', error?.message)
      return DEFAULTS
    }

    return { returning_customer_autofill_enabled: Boolean(data.returning_customer_autofill_enabled) }
  } catch (err) {
    console.warn('[CHECKOUT-SETTINGS] Unexpected error loading checkout_settings — using defaults:', err)
    return DEFAULTS
  }
}
