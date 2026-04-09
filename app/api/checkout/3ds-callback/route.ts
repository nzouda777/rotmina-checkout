import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

    const responseCode = params.Response || params.response_code || params.status
    const confirmationCode = params.ConfirmationCode || params.confirmation_code || params.transaction_id
    const isSuccess =
      responseCode === '000' ||
      responseCode === 'approved' ||
      responseCode === 'success' ||
      params.success === 'true'

    console.log('[3DS-CALLBACK] sessionId:', sessionId, '| isSuccess:', isSuccess, '| code:', responseCode)

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
          // L'URL de confirmation Shopify — adapte selon ta structure
          shopifyOrderUrl = order.order_status_url || `https://${session.shop}/orders/${order.id}`
          console.log('[3DS-CALLBACK] Shopify order created:', shopifyOrderId)
        } catch (err) {
          console.error('[3DS-CALLBACK] Shopify order failed:', err)
          // Ne pas bloquer — le paiement est quand même réussi
        }
      }

      await supabase
        .from('payment_sessions')
        .update({
          status: 'paid',
          tranzila_transaction_id: confirmationCode || null,
          order_id: shopifyOrderId,
          raw_response: params as any,
          error_message: null,
        })
        .eq('id', sessionId)

      // Rediriger vers la confirmation Shopify
      return redirectToShopify(session, shopifyOrderUrl)

    } else {
      const errorMsg =
        params.message ||
        params.error ||
        getErrorFromCode(responseCode)

      await supabase
        .from('payment_sessions')
        .update({
          status: 'failed',
          raw_response: params as any,
          error_message: errorMsg,
        })
        .eq('id', sessionId)

      console.log('[3DS-CALLBACK] Payment failed:', errorMsg)
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