import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
  const adminKey = process.env.ADMIN_API_KEY
  return !!adminKey && key === adminKey
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: idStr } = await params
  const id = Number(idStr)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.country !== undefined) {
    const country = String(body.country).trim()
    if (!country) return NextResponse.json({ error: 'country cannot be empty' }, { status: 400 })
    updates.country = country
  }
  if (body.tax_rate !== undefined) {
    const rate = Number(body.tax_rate)
    if (isNaN(rate) || rate < 0 || rate > 100) {
      return NextResponse.json({ error: 'tax_rate must be between 0 and 100' }, { status: 400 })
    }
    updates.tax_rate = rate
  }
  if (body.enabled !== undefined) {
    updates.enabled = Boolean(body.enabled)
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tax_rules')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[ADMIN] Failed to update tax rule:', error)
    return NextResponse.json({ error: 'Failed to update tax rule' }, { status: 500 })
  }

  return NextResponse.json({ rule: data })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: idStr } = await params
  const id = Number(idStr)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.from('tax_rules').delete().eq('id', id)

  if (error) {
    console.error('[ADMIN] Failed to delete tax rule:', error)
    return NextResponse.json({ error: 'Failed to delete tax rule' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
