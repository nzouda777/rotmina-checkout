import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { CustomerInfo } from '@/lib/types'

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
  const adminKey = process.env.ADMIN_API_KEY
  return !!adminKey && key === adminKey
}

export interface CustomerSummary {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  address?: string
  city?: string
  country?: string
  province?: string
  postalCode?: string
  orderCount: number
  lastOrderAt: string
}

// There is no dedicated "customers" table — a customer is just whoever's
// info is attached to a paid session, so this aggregates payment_sessions by
// email. Capped at the 5,000 most recent paid orders (fetched newest-first,
// so the first occurrence of an email is already their latest info) — a
// customer whose only orders fall outside that window won't show up.
const MAX_SESSIONS_SCANNED = 5000

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = 25
  const search = (searchParams.get('search') || '').trim().toLowerCase()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payment_sessions')
    .select('customer, created_at')
    .eq('status', 'paid')
    .not('customer', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MAX_SESSIONS_SCANNED)

  if (error) {
    console.error('[ADMIN-CUSTOMERS] Error:', error)
    return NextResponse.json({ error: 'Failed to load customers' }, { status: 500 })
  }

  const byEmail = new Map<string, CustomerSummary>()
  for (const row of data || []) {
    const customer = row.customer as CustomerInfo | null
    const email = (customer?.email || '').trim().toLowerCase()
    if (!email) continue

    const existing = byEmail.get(email)
    if (!existing) {
      // Rows are ordered newest-first, so the first time we see an email its
      // customer info is already the most recent — nothing more to update.
      byEmail.set(email, {
        email,
        firstName: customer!.firstName,
        lastName: customer!.lastName,
        phone: customer!.phone,
        address: customer!.address,
        city: customer!.city,
        country: customer!.country,
        province: customer!.province,
        postalCode: customer!.postalCode,
        orderCount: 1,
        lastOrderAt: row.created_at,
      })
    } else {
      existing.orderCount += 1
    }
  }

  let customers = Array.from(byEmail.values())

  if (search) {
    customers = customers.filter((c) =>
      c.email.includes(search) ||
      `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase().includes(search) ||
      (c.phone || '').toLowerCase().includes(search)
    )
  }

  const total = customers.length
  const paged = customers.slice((page - 1) * limit, page * limit)

  return NextResponse.json({ customers: paged, total, page, limit })
}
