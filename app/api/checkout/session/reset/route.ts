import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Reset a payment session status back to 'pending' when the user cancels
 * the 3DS/Bit verification modal. This allows them to retry the payment.
 * 
 * Only resets if the session is in a "waiting" state (processing, pending_3ds, pending_bit).
 * Does NOT reset already paid or permanently failed sessions.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const supabase = await createClient()

    // Reset sessions that are in an intermediate or failed state so users can retry
    const resettableStatuses = ['processing', 'pending_3ds', 'pending_bit', 'failed']

    const { data: session, error: fetchError } = await supabase
      .from('payment_sessions')
      .select('id, status')
      .eq('id', sessionId)
      .single()

    if (fetchError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    if (!resettableStatuses.includes(session.status)) {
      console.log(`[SESSION-RESET] Session ${sessionId} is in '${session.status}' state, not resetting`)
      return NextResponse.json({ 
        reset: false, 
        reason: `Session is '${session.status}', only resettable from: ${resettableStatuses.join(', ')}` 
      })
    }

    const { error: updateError } = await supabase
      .from('payment_sessions')
      .update({ 
        status: 'pending',
        error_message: null,
      })
      .eq('id', sessionId)

    if (updateError) {
      console.error('[SESSION-RESET] Failed to reset session:', updateError)
      return NextResponse.json({ error: 'Failed to reset session' }, { status: 500 })
    }

    console.log(`[SESSION-RESET] Session ${sessionId} reset from '${session.status}' to 'pending'`)
    return NextResponse.json({ reset: true })

  } catch (error: any) {
    console.error('[SESSION-RESET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
