import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import type { PaymentSession, CustomerInfo } from '@/lib/types'

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
    // Retrieve the track_id from the stored raw_response
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
    const confirmationCode =
      (completeResponse as any).ConfirmationCode ||
      (completeResponse as any).confirmation_code ||
      (completeResponse as any).transaction_id ||
      (completeResponse as any).index
    // ──────────────────────────────────────────────────────────────────

    if (isSuccess) {
      // Créer la commande Shopify
      let shopifyOrderId = session.order_id
      let shopifyOrderUrl = null

      if (!shopifyOrderId) {
        try {
          console.log('[3DS-CALLBACK] Creating Shopify order...')
          const order = await createShopifyOrder({
            session: session as PaymentSession,
            customer: session.customer as CustomerInfo,
            transactionId: confirmationCode,
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
          raw_response: completeResponse as any,
          error_message: null,
        })
        .eq('id', sessionId)

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
  return new NextResponse(
    `<html>
      <body>
        <script>
          window.top.location.href = "${url}";
        </script>
        <p>Redirecting...</p>
      </body>
    </html>`,
    {
      headers: { 'Content-Type': 'text/html' },
    }
  )
}

function getErrorFromCode(code: string): string {
  const codes: Record<string, string> = {
    '001': 'Carte bloquée',
    '002': 'Carte volée',
    '004': 'Transaction refusée',
    '006': 'CVV ou ID invalide',
    '010': 'Transaction non approuvée',
    '011': 'Montant invalide',
    '012': 'Numéro de carte invalide',
    '017': 'Carte expirée',
    '033': 'Devise invalide',
  }
  return codes[code] || `Paiement échoué (code: ${code})`
}