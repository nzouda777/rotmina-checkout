import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
  const adminKey = process.env.ADMIN_API_KEY
  return !!adminKey && key === adminKey
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { status } = body as { status?: string }
  if (!status || !['active', 'disabled'].includes(status)) {
    return NextResponse.json({ error: 'status must be "active" or "disabled"' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('coupon_codes')
    .update({ status })
    .eq('id', id)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to update coupon' }, { status: 500 })
  }

  return NextResponse.json({ coupon: data })
}
