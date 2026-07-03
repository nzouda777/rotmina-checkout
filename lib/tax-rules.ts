import { createClient } from '@/lib/supabase/server'

export interface TaxRule {
  id: number
  country: string
  tax_rate: number
  enabled: boolean
  updated_at?: string
}

export async function getTaxRules(): Promise<TaxRule[]> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('tax_rules')
      .select('*')
      .order('country', { ascending: true })

    if (error || !data) {
      console.warn('[TAX] Could not load tax_rules from DB:', error?.message)
      return []
    }
    return data as TaxRule[]
  } catch (err) {
    console.warn('[TAX] Unexpected error loading tax_rules:', err)
    return []
  }
}

export function getTaxRateForCountry(rules: TaxRule[], country: string): number {
  const rule = rules.find((r) => r.country === country && r.enabled)
  return rule ? Number(rule.tax_rate) : 0
}
