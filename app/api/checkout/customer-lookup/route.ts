import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCheckoutSettings } from '@/lib/checkout-settings'
import type { CustomerInfo } from '@/lib/types'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Returning-customer autofill — looks up the most recent paid order for the
 * given email and returns its saved customer info, so the checkout form can
 * pre-fill name/address/phone. Admin-toggleable (see /admin/checkout-settings)
 * since this matches purely on the typed email with no verification.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const email = (searchParams.get('email') || '').trim().toLowerCase()

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ found: false }, { headers: CORS_HEADERS })
  }

  const settings = await getCheckoutSettings()
  if (!settings.returning_customer_autofill_enabled) {
    return NextResponse.json({ found: false }, { headers: CORS_HEADERS })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payment_sessions')
    .select('customer, updated_at')
    .eq('status', 'paid')
    .ilike('customer->>email', email)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0 || !data[0].customer) {
    return NextResponse.json({ found: false }, { headers: CORS_HEADERS })
  }

  // Never return the national ID — it's a government ID, not needed for
  // convenience autofill, and the customer can always retype it.
  const { nationalId, ...customer } = data[0].customer as CustomerInfo

  return NextResponse.json({ found: true, customer }, { headers: CORS_HEADERS })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
