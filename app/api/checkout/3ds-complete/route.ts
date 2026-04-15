import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import { debitGiftCard, generateGiftCardsForOrder } from '@/lib/gift-cards'
import type { PaymentSession, CustomerInfo, GiftCardInfo } from '@/lib/types'

/**
 * Manual 3DS complete endpoint — called by the frontend after the 3DS challenge
 * This is needed because Tranzila sometimes doesn't redirect back to our callback
 */
export async function POST(request: NextRequest) {
  console.log('[3DS-COMPLETE] Manual 3DS completion triggered')

  try {
    const body = await request.json()
    const { sessionId, trackId: clientTrackId } = body

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: session, error } = await supabase
      .from('payment_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (error || !session) {
      console.error('[3DS-COMPLETE] Session not found:', sessionId)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Already paid — return success immediately
    if (session.status === 'paid') {
      console.log('[3DS-COMPLETE] Already paid')
      return NextResponse.json({
        success: true,
        confirmationCode: session.tranzila_transaction_id,
        alreadyProcessed: true,
      })
    }

    // Must be in a state where 3DS completion makes sense
    if (session.status !== 'pending_3ds' && session.status !== 'processing' && session.status !== 'pending') {
      console.log('[3DS-COMPLETE] Session not in 3DS state:', session.status)
      return NextResponse.json({
        error: `Session is in '${session.status}' state, not pending 3DS`,
        status: session.status,
      }, { status: 400 })
    }

    // Use trackId from client first (avoids race condition), then fall back to DB
    const trackId =
      clientTrackId ||
      session.tranzila_transaction_id ||
      session.raw_response?.['3ds_data']?.track_id ||
      session.raw_response?.track_id

    if (!trackId) {
      console.error('[3DS-COMPLETE] No track_id found for session:', sessionId)
      return NextResponse.json({ error: 'No track_id found — 3DS not ready yet', pending: true }, { status: 400 })
    }

    console.log('[3DS-COMPLETE] Calling 3DS Complete with track_id:', trackId)
    const tranzila = createTranzilaClient()
    const completeResponse = await tranzila.complete3DS(trackId)
    console.log('[3DS-COMPLETE] Complete response:', JSON.stringify(completeResponse))

    const isSuccess = TranzilaClient.isSuccess(completeResponse)
    const txnResult = (completeResponse as any).transaction_result
    const confirmationCode =
      txnResult?.auth_number ||
      txnResult?.transaction_id ||
      (completeResponse as any).ConfirmationCode ||
      (completeResponse as any).confirmation_code ||
      (completeResponse as any).transaction_id ||
      (completeResponse as any).index

    if (isSuccess) {
      // ── Post-payment: Gift card debit + generation ──────────────────
      const storedGiftCard = session.raw_response?._gift_card
      let remainingBalance: number | undefined

      if (storedGiftCard?.code && storedGiftCard?.appliedAmount > 0) {
        try {
          console.log('[3DS-COMPLETE] Debiting gift card:', storedGiftCard.code)
          const updatedCard = await debitGiftCard({
            code: storedGiftCard.code,
            amount: storedGiftCard.appliedAmount,
            sessionId,
          })
          remainingBalance = updatedCard.balance
        } catch (gcError) {
          console.error('[3DS-COMPLETE] Gift card debit failed:', gcError)
        }
      }

      let generatedCards: any[] = []
      try {
        const customer = session.customer as CustomerInfo
        generatedCards = await generateGiftCardsForOrder({
          items: session.cart?.items || [],
          sessionId,
          buyerEmail: customer?.email,
          currency: session.cart?.currency || 'ILS',
        })
        if (generatedCards.length > 0) {
          console.log('[3DS-COMPLETE] Generated gift cards:', generatedCards.map((c: any) => c.code))
        }
      } catch (err) {
        console.error(`[3DS-COMPLETE][${sessionId}] Gift card generation CRITICAL error:`, err)
      }

      // Create Shopify order
      let shopifyOrderId = session.order_id
      let shopifyOrderUrl: string | undefined

      let giftCardInfo: GiftCardInfo | undefined
      if (storedGiftCard?.code && storedGiftCard?.appliedAmount > 0) {
        giftCardInfo = {
          id: storedGiftCard.id || '',
          code: storedGiftCard.code,
          balance: storedGiftCard.appliedAmount,
          currency: session.cart?.currency || 'ILS',
          appliedAmount: storedGiftCard.appliedAmount,
        }
      }

      if (!shopifyOrderId) {
        try {
          console.log('[3DS-COMPLETE] Creating Shopify order...')
          const order = await createShopifyOrder({
            session: session as PaymentSession,
            customer: session.customer as CustomerInfo,
            transactionId: confirmationCode,
            giftCard: giftCardInfo,
          })
          shopifyOrderId = String(order.id)
          shopifyOrderUrl = order.order_status_url || `https://${session.shop}/orders/${order.id}`
          console.log('[3DS-COMPLETE] Shopify order created:', shopifyOrderId)
        } catch (err) {
          console.error('[3DS-COMPLETE] Shopify order failed:', err)
        }
      }

      await supabase
        .from('payment_sessions')
        .update({
          status: 'paid',
          tranzila_transaction_id: confirmationCode || trackId,
          order_id: shopifyOrderId,
          raw_response: {
            ...completeResponse as any,
            _gift_card: storedGiftCard ? { ...storedGiftCard, remainingBalance } : null,
            _generated_gift_cards: generatedCards.map((c: any) => ({
              code: c.code,
              amount: c.original_amount,
              currency: c.currency,
            })),
          },
          error_message: null,
        })
        .eq('id', sessionId)

      return NextResponse.json({
        success: true,
        confirmationCode: confirmationCode || trackId,
        shopifyOrderUrl,
        generatedGiftCards: generatedCards.map((c: any) => ({
          code: c.code,
          amount: c.original_amount,
          currency: c.currency,
        })),
        giftCardRemainingBalance: remainingBalance,
      })

    } else {
      const errorMsg = TranzilaClient.getErrorMessage(completeResponse)
      const rawResStr = JSON.stringify(completeResponse)
      
      // If error is 930 (Authentication attempted but not finished) or similar "pending" errors
      // OR if the session is still fresh (less than 10 mins old), we just assume it's still being processed.
      const isPending = rawResStr.includes('930') || rawResStr.includes('not finished') || rawResStr.includes('Authentication attempted');
      
      const sessionAgeMinutes = (Date.now() - new Date(session.created_at).getTime()) / 60000;
      
      if (isPending || sessionAgeMinutes < 10) {
        console.log('[3DS-COMPLETE] Transaction not finished yet, returning pending...', { errorMsg });
        return NextResponse.json({
          pending: true,
          error: errorMsg
        })
      }

      await supabase
        .from('payment_sessions')
        .update({
          status: 'failed',
          raw_response: completeResponse as any,
          error_message: errorMsg,
        })
        .eq('id', sessionId)

      return NextResponse.json({
        success: false,
        error: errorMsg || 'Payment failed after 3DS verification',
      })
    }

  } catch (error: any) {
    console.error('[3DS-COMPLETE] CRITICAL ERROR:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
