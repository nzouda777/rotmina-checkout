import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import { debitGiftCard, generateGiftCardsForOrder } from '@/lib/gift-cards'
import type { PaymentSession, CustomerInfo, GiftCardInfo } from '@/lib/types'

// Tranzila peut appeler en GET ou POST selon la config
export async function GET(request: NextRequest) {
  return handleCallback(request)
}

export async function POST(request: NextRequest) {
  return handleCallback(request)
}

async function handleCallback(request: NextRequest) {
  console.log('[3DS-CALLBACK] Received from Tranzila')

  try {
    // Parser les params selon la méthode (GET = query params, POST = form ou JSON)
    let params: Record<string, string> = {}

    if (request.method === 'GET') {
      const { searchParams } = new URL(request.url)
      searchParams.forEach((value, key) => { params[key] = value })
    } else {
      const contentType = request.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        params = await request.json()
      } else {
        // form-urlencoded (le plus courant chez Tranzila)
        const formData = await request.formData()
        formData.forEach((value, key) => { params[key] = String(value) })
      }
    }

    console.log('[3DS-CALLBACK] Params:', JSON.stringify(params))

    // Récupérer le sessionId — Tranzila retourne merchant_data tel quel
    const sessionId =
      params.merchant_data ||
      params.merchantData ||
      params.session_id ||
      params.userData

    console.log('[3DS-CALLBACK] sessionId:', sessionId)

    if (!sessionId) {
      console.error('[3DS-CALLBACK] No sessionId found in params')
      return redirectToError('Session introuvable')
    }

    const supabase = await createClient()

    const { data: session, error } = await supabase
      .from('payment_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (error || !session) {
      console.error('[3DS-CALLBACK] Session not found:', sessionId)
      return redirectToError('Session introuvable')
    }

    // Éviter le double traitement
    if (session.status === 'paid') {
      console.log('[3DS-CALLBACK] Already paid, redirecting to Shopify')
      return redirectToShopify(session)
    }

    // ── Step 3: Call Tranzila 3DS Complete ─────────────────────────────
    const trackId =
      params.track_id ||
      session.tranzila_transaction_id ||
      session.raw_response?.['3ds_data']?.track_id

    if (!trackId) {
      console.error('[3DS-CALLBACK] No track_id found')
      return redirectToError('3DS verification failed: missing track_id')
    }

    console.log('[3DS-CALLBACK] Calling 3DS Complete with track_id:', trackId)
    const tranzila = createTranzilaClient()
    const completeResponse = await tranzila.complete3DS(trackId)
    console.log('[3DS-CALLBACK] Complete response:', JSON.stringify(completeResponse))

    const isSuccess = TranzilaClient.isSuccess(completeResponse)
    const txnResult = (completeResponse as any).transaction_result
    const confirmationCode =
      txnResult?.auth_number ||
      txnResult?.transaction_id ||
      (completeResponse as any).ConfirmationCode ||
      (completeResponse as any).confirmation_code ||
      (completeResponse as any).transaction_id ||
      (completeResponse as any).index
    // ──────────────────────────────────────────────────────────────────

    if (isSuccess) {
      // ── Post-payment: Gift card debit + generation ──────────────────
      const storedGiftCard = session.raw_response?._gift_card
      let remainingBalance: number | undefined
      
      // Debit gift card if used as payment
      if (storedGiftCard?.code && storedGiftCard?.appliedAmount > 0) {
        try {
          console.log('[3DS-CALLBACK] Debiting gift card:', storedGiftCard.code)
          const updatedCard = await debitGiftCard({
            code: storedGiftCard.code,
            amount: storedGiftCard.appliedAmount,
            sessionId,
          })
          remainingBalance = updatedCard.balance
          console.log(`[3DS-CALLBACK] Gift card debited successfully - remaining: ${remainingBalance}`)
        } catch (gcError) {
          console.error('[3DS-CALLBACK] Gift card debit failed:', gcError)
        }
      }

      // Generate gift card codes if cart contains gift card products
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
          console.log('[3DS-CALLBACK] Generated gift cards:', generatedCards.map((c: any) => c.code))
        }
      } catch (err) {
        console.error('[3DS-CALLBACK] Gift card generation failed:', err)
      }

      // Créer la commande Shopify
      let shopifyOrderId = session.order_id
      let shopifyOrderUrl = null
      
      // Build gift card info for Shopify order
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
          console.log('[3DS-CALLBACK] Creating Shopify order...')
          const order = await createShopifyOrder({
            session: session as PaymentSession,
            customer: session.customer as CustomerInfo,
            transactionId: confirmationCode,
            giftCard: giftCardInfo,
          })
          shopifyOrderId = String(order.id)
          shopifyOrderUrl = order.order_status_url || `https://${session.shop}/orders/${order.id}`
          console.log('[3DS-CALLBACK] Shopify order created:', shopifyOrderId)
        } catch (err) {
          console.error('[3DS-CALLBACK] Shopify order failed:', err)
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

      // Redirect to Shopify native order status page
      return redirectToShopify(session, shopifyOrderUrl)

    } else {
      const errorMsg = TranzilaClient.getErrorMessage(completeResponse)

      await supabase
        .from('payment_sessions')
        .update({
          status: 'failed',
          raw_response: completeResponse as any,
          error_message: errorMsg,
        })
        .eq('id', sessionId)

      console.log('[3DS-CALLBACK] Payment failed after 3DS Complete:', errorMsg)
      return redirectToError(errorMsg, sessionId)
    }

  } catch (error: any) {
    console.error('[3DS-CALLBACK] CRITICAL ERROR:', error)
    return redirectToError('Erreur interne du serveur')
  }
}

function redirectToSuccess(sessionId: string, confirmationCode: string, giftCardCodes?: string, usedGiftCardCode?: string, remainingBalance?: number) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
  const params = new URLSearchParams({
    session: sessionId,
    confirmation: confirmationCode,
  })
  if (giftCardCodes) params.set('gift_cards', giftCardCodes)
  if (usedGiftCardCode) params.set('used_gc', usedGiftCardCode)
  if (remainingBalance !== undefined) params.set('gc_remaining', String(remainingBalance))
  
  const targetUrl = `${baseUrl}/checkout/success?${params.toString()}`
  return breakoutRedirect(targetUrl)
}

function redirectToShopify(session: any, orderUrl?: string | null) {
  const targetUrl = orderUrl || `https://${session.shop}`
  return breakoutRedirect(targetUrl)
}

function redirectToError(message: string, sessionId?: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
  const params = new URLSearchParams({ error: message })
  if (sessionId) params.set('session', sessionId)
  const targetUrl = `${baseUrl}/checkout/error?${params.toString()}`
  return breakoutRedirect(targetUrl)
}

function breakoutRedirect(url: string) {
  // Since 3DS now runs in a popup, just close it.
  // The main checkout page polls the session and will handle the redirect.
  return new NextResponse(
    `<html>
      <body>
        <script>
          try {
            // If we're in a popup, close it. The parent page polls for completion.
            if (window.opener) {
              window.close();
            } else {
              // Fallback: redirect normally if not in a popup
              window.top.location.href = "${url}";
            }
          } catch(e) {
            window.location.href = "${url}";
          }
        </script>
        <p>Verification complete. This window will close automatically...</p>
      </body>
    </html>`,
    {
      headers: { 'Content-Type': 'text/html' },
    }
  )
}