import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import { debitGiftCard, generateGiftCardsForOrder } from '@/lib/gift-cards'
import { sendOrderConfirmationEmail } from '@/lib/email'
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
      const shopifyDomain = session.shop || 'rotmina.myshopify.com'
      const shopifyOrderUrl = `https://${shopifyDomain}/pages/success${session.order_id ? `?order_id=${session.order_id}` : ''}`
      
      return NextResponse.json({
        success: true,
        confirmationCode: session.tranzila_transaction_id,
        alreadyProcessed: true,
        shopifyOrderUrl: shopifyOrderUrl,
      })
    }

    // Must be in a state where 3DS completion makes sense.
    // 'pending' means the user cancelled and session/reset was called — do NOT complete.
    if (session.status !== 'pending_3ds' && session.status !== 'processing') {
      console.log('[3DS-COMPLETE] Session not in 3DS state:', session.status)
      return NextResponse.json({
        error: `Session is in '${session.status}' state, not pending 3DS`,
        status: session.status,
        pending: session.status === 'pending',
      }, { status: 400 })
    }

    // Use trackId from client first (avoids race condition), then fall back to DB
    const trackId =
      clientTrackId ||
      session.tranzila_transaction_id ||
      session.raw_response?.['3ds_data']?.track_id ||
      session.raw_response?.track_id

    if (!trackId) {
      console.log('[3DS-COMPLETE] No track_id found yet for session:', sessionId)
      return NextResponse.json({ error: 'No track_id found — 3DS not ready yet', pending: true })
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

    console.log('[3DS-COMPLETE] Payment decision:', {
      isSuccess,
      processor_response_code: txnResult?.processor_response_code,
      approved: txnResult?.approved,
      auth_number: txnResult?.auth_number,
      error_code: (completeResponse as any).error_code,
      confirmationCode,
    })

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
          const shopifyDomain = session.shop || 'rotmina.myshopify.com'
          shopifyOrderUrl = `https://${shopifyDomain}/pages/success?order_id=${shopifyOrderId}`
          console.log('[3DS-COMPLETE] Shopify order created:', shopifyOrderId)

          // ── Send Order Confirmation Email ────────────────────────
          try {
            const customerInfo = session.customer as CustomerInfo
            console.log(`[3DS-COMPLETE][${sessionId}] Sending order confirmation email...`)
            await sendOrderConfirmationEmail({
              toEmail: customerInfo.email,
              orderName: String(order.name || order.id),
              customerName: `${customerInfo.firstName} ${customerInfo.lastName}`,
              items: session.cart.items.map((item: any) => ({
                title: item.title,
                quantity: item.quantity,
                price: item.price,
                image: item.image,
              })),
              subtotal: session.cart.subtotal,
              shipping: session.cart.shipping,
              tax: session.cart.tax,
              total: session.cart.total,
              currency: session.cart.currency,
              shippingAddress: {
                address: customerInfo.address,
                city: customerInfo.city,
                postalCode: customerInfo.postalCode,
                country: customerInfo.country,
              },
              orderStatusUrl: shopifyOrderUrl,
            })
          } catch (emailErr) {
            console.error(`[3DS-COMPLETE][${sessionId}] Failed to send order confirmation email:`, emailErr)
          }
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
      
      // Only treat as "pending" if the 3DS challenge itself hasn't completed yet
      // (error 930 = "Authentication attempted but not finished")
      // Real declines (insufficient funds, expired card, etc.) should NOT be treated as pending
      const is3DSStillInProgress = rawResStr.includes('930') || rawResStr.includes('not finished') || rawResStr.includes('Authentication attempted');
      
      // Check if this is an actual processor decline (not a 3DS flow issue)
      const txnResult = (completeResponse as any)?.transaction_result
      const processorCode = txnResult?.processor_response_code
      const isActualDecline = processorCode && processorCode !== '000'
      
      if (is3DSStillInProgress && !isActualDecline) {
        console.log('[3DS-COMPLETE] 3DS challenge not finished yet, returning pending...', { errorMsg });
        return NextResponse.json({
          pending: true,
          error: errorMsg
        })
      }

      console.log('[3DS-COMPLETE] Transaction DECLINED:', { errorMsg, processorCode })

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
