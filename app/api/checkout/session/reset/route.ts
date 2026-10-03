import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sanitizeGatewayResponse } from '@/lib/tranzila-response'

/**
 * Reset a payment session status back to 'pending' when the user cancels
 * the 3DS/Bit verification modal. This allows them to retry the payment.
 * 
 * Only resets if the session is in a "waiting" state (processing, pending_3ds, pending_bit).
 * Does NOT reset already paid or permanently failed sessions.
 *
 * The reason for the failed attempt is kept in raw_response._last_failure so the
 * admin panel can still explain it after the session goes back to 'pending'.
 * The checkout may send { failure: { code, message, method } } for declines the
 * gateway only reported to the browser (SDK result, 3DS modal closed).
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId, failure } = await request.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const supabase = await createClient()

    // Reset sessions that are in an intermediate or failed state so users can retry
    const resettableStatuses = ['processing', 'pending_3ds', 'pending_bit', 'failed']

    const { data: session, error: fetchError } = await supabase
      .from('payment_sessions')
      .select('id, status, error_message, raw_response')
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

    // Server-recorded reason wins over what the browser reports.
    const clip = (v: unknown, max: number) =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
    const serverMessage = clip(session.error_message, 300)
    const clientMessage = clip(failure?.message, 300)
    const lastFailure = serverMessage || clientMessage || failure?.gateway_response
      ? {
          message: serverMessage || clientMessage,
          code: clip(failure?.code, 10),
          method: failure?.method === 'bit' ? 'bit' : failure?.method === 'card' ? 'card' : undefined,
          source: serverMessage ? 'gateway' : 'checkout',
          // What Tranzila returned to the browser (SDK result), for the admin panel
          gateway_response: sanitizeGatewayResponse(failure?.gateway_response),
          previous_status: session.status,
          at: new Date().toISOString(),
        }
      : undefined

    const { error: updateError } = await supabase
      .from('payment_sessions')
      .update({
        status: 'pending',
        error_message: null,
        ...(lastFailure
          ? { raw_response: { ...((session.raw_response as Record<string, unknown>) || {}), _last_failure: lastFailure } }
          : {}),
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
