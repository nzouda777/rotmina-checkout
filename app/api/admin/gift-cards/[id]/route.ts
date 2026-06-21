import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
  const adminKey = process.env.ADMIN_API_KEY
  return !!adminKey && key === adminKey
}

// PATCH /api/admin/gift-cards/[id] — update status (disable/re-enable)
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
    .from('gift_cards')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error || !data) {
    console.error('[ADMIN] Failed to update gift card:', error)
    return NextResponse.json({ error: 'Failed to update gift card' }, { status: 500 })
  }

  return NextResponse.json({ card: data })
}
