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
    .from('checkout_settings')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to load checkout settings' }, { status: 500 })
  }

  return NextResponse.json({ settings: data })
}

export async function PUT(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('checkout_settings')
    .upsert({
      id: 1,
      returning_customer_autofill_enabled: Boolean(body.returning_customer_autofill_enabled),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('[ADMIN] Failed to update checkout settings:', error)
    return NextResponse.json({ error: 'Failed to update checkout settings' }, { status: 500 })
  }

  return NextResponse.json({ settings: data })
}
