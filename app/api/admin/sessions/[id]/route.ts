import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function checkAuth(req: NextRequest) {
  const key = req.headers.get('x-admin-key')
  return !!process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: session, error } = await supabase
    .from('payment_sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Fetch associated gift card if any
  let giftCard = null
  const gcCode = session.raw_response?._gift_card?.code
  if (gcCode) {
    const { data: gc } = await supabase
      .from('gift_cards')
      .select('id, code, discount_type, discount_value, original_amount, balance, status')
      .eq('code', gcCode)
      .single()
    giftCard = gc
  }

  return NextResponse.json({ session, giftCard })
}
