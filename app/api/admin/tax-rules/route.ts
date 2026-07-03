import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
  const adminKey = process.env.ADMIN_API_KEY
  return !!adminKey && key === adminKey
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tax_rules')
    .select('*')
    .order('country', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Failed to load tax rules' }, { status: 500 })
  }

  return NextResponse.json({ rules: data })
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const country = String(body.country || '').trim()
  const taxRate = Number(body.tax_rate)
  const enabled = body.enabled !== false

  if (!country) {
    return NextResponse.json({ error: 'country is required' }, { status: 400 })
  }
  if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
    return NextResponse.json({ error: 'tax_rate must be between 0 and 100' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tax_rules')
    .insert({ country, tax_rate: taxRate, enabled, updated_at: new Date().toISOString() })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: `A rule for "${country}" already exists` }, { status: 409 })
    }
    console.error('[ADMIN] Failed to create tax rule:', error)
    return NextResponse.json({ error: 'Failed to create tax rule' }, { status: 500 })
  }

  return NextResponse.json({ rule: data }, { status: 201 })
}
