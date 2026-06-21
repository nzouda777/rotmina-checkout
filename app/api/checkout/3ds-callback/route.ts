import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import { debitGiftCard, generateGiftCardsForOrder } from '@/lib/gift-cards'
import { sendMorningReceipt, detectPaymentMethod } from '@/lib/morning'
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

    // Extract query parameters from URL for BOTH GET and POST methods
    const { searchParams } = new URL(request.url)
    searchParams.forEach((value, key) => { params[key] = value })

    if (request.method !== 'GET') {
      const contentType = request.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const jsonParams = await request.json()
        params = { ...params, ...jsonParams }
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
      .or(`id.eq.${sessionId},tranzila_transaction_id.eq.${sessionId}`)
      .single()

    if (error || !session) {
      console.error('[3DS-CALLBACK] Session not found:', sessionId)
      return redirectToError('Session introuvable')
    }

    const actualSessionId = session.id

    if (session.status === 'paid') {
      console.log('[3DS-CALLBACK] Already paid, redirecting to success page')
      return redirectToSuccess(actualSessionId, session.tranzila_transaction_id)
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

    console.log('[3DS-CALLBACK] Payment decision:', {
      isSuccess,
      processor_response_code: txnResult?.processor_response_code,
      approved: txnResult?.approved,
      auth_number: txnResult?.auth_number,
      error_code: (completeResponse as any).error_code,
      confirmationCode,
    })
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
            sessionId: actualSessionId,
          })
          remainingBalance = updatedCard.balance ?? undefined
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
          shopifyOrderUrl = order.order_status_url || null
          console.log('[3DS-CALLBACK] Shopify order created:', shopifyOrderId, 'status_url:', shopifyOrderUrl)
        } catch (err) {
          console.error('[3DS-CALLBACK] Shopify order failed:', err)
        }
      }

      // ── Send Morning Receipt ───────────────────────────────
      try {
        const customerInfo = session.customer as CustomerInfo
        if (customerInfo) {
          console.log(`[3DS-CALLBACK][${actualSessionId}] Sending Morning receipt...`)
          await sendMorningReceipt({
            customerEmail: customerInfo.email,
            customerName: `${customerInfo.firstName} ${customerInfo.lastName}`,
            amount: Number(session.cart.total),
            currency: session.cart.currency,
            paymentMethod: detectPaymentMethod(session.raw_response),
            items: session.cart.items.map((item: any) => ({
              description: item.title,
              quantity: item.quantity,
              price: Number(item.price),
            })),
          })
        }
      } catch (morningErr) {
        console.error(`[3DS-CALLBACK][${actualSessionId}] Failed to send Morning receipt:`, morningErr)
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
        .eq('id', actualSessionId)

      // Redirect to Shopify native success page
      return redirectToShopify(session, shopifyOrderId, shopifyOrderUrl)

    } else {
      const errorMsg = TranzilaClient.getErrorMessage(completeResponse)

      await supabase
        .from('payment_sessions')
        .update({
          status: 'failed',
          raw_response: completeResponse as any,
          error_message: errorMsg,
        })
        .eq('id', actualSessionId)

      console.log('[3DS-CALLBACK] Payment failed after 3DS Complete:', errorMsg)
      return redirectToError(errorMsg, sessionId, errorMsg)
    }

  } catch (error: any) {
    console.error('[3DS-CALLBACK] CRITICAL ERROR:', error)
    return redirectToError('Erreur interne du serveur')
  }
}

function redirectToSuccess(sessionId: string, confirmationCode: string) {
  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL || 'https://rotmina.co'
  const targetUrl = `${storeUrl}/pages/success?session=${sessionId}&confirmation=${confirmationCode}`
  return breakoutRedirect(targetUrl, sessionId)
}

function redirectToShopify(session: any, shopifyOrderId?: string | null, orderStatusUrl?: string | null) {
  const shopifyDomain = session.shop || 'rotmina.myshopify.com'
  const targetUrl = orderStatusUrl || `https://${shopifyDomain}/pages/success${shopifyOrderId ? `?order_id=${shopifyOrderId}` : ''}`
  return breakoutRedirect(targetUrl, session.id)
}

function redirectToError(message: string, sessionId?: string, errorMessage?: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const targetUrl = `${baseUrl}/checkout/s=error`
  return breakoutRedirect(targetUrl, sessionId, errorMessage)
}

function breakoutRedirect(url: string, sessionId?: string, errorMessage?: string) {
  // 3DS runs in an iframe on the checkout page.
  // Send postMessage to the parent with the result URL so it can handle it.
  const safeError = (errorMessage || '').replace(/'/g, "\\'").replace(/"/g, '&quot;')
  return new NextResponse(
    `<html>
      <body>
        <script>
          try {
            // Parse result from URL
            var isSuccess = "${url}".includes('/checkout/success') || "${url}".includes('/pages/success') || ("${url}".includes('/orders/') && "${url}".includes('key='));
            var result = {
              type: '3DS_COMPLETE',
              success: isSuccess,
              url: "${url}",
              sessionId: "${sessionId || ''}",
              errorMessage: "${safeError}"
            };
            // Send to parent (the checkout page)
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(result, '*');
            } else if (window.opener) {
              window.opener.postMessage(result, '*');
              window.close();
            } else {
              window.location.href = "${url}";
            }
          } catch(e) {
            window.location.href = "${url}";
          }
        </script>
        <p>Verification complete. Processing payment...</p>
      </body>
    </html>`,
    {
      headers: { 'Content-Type': 'text/html' },
    }
  )
}