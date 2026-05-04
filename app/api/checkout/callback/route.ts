import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createShopifyOrder } from '@/lib/shopify'
import type { PaymentSession, CustomerInfo } from '@/lib/types'

const TRANZILA_RESPONSE_CODES: Record<string, string> = {
  '000': 'Approved',
  '001': 'Card blocked – contact your bank',
  '002': 'Card stolen – contact your bank',
  '003': 'Contact your credit company',
  '004': 'Refused by bank',
  '005': 'Do not honor – card rejected by bank',
  '006': 'CVV or ID verification error',
  '007': 'Contact your credit company',
  '009': 'Transaction not permitted',
  '010': 'Transaction not approved',
  '011': 'Invalid amount',
  '012': 'Invalid card number',
  '014': 'Invalid terminal',
  '015': 'Terminal not found',
  '017': 'Card expired',
  '033': 'Invalid currency or test/live mode mismatch',
  '041': 'Lost card',
  '043': 'Stolen card',
  '051': 'Insufficient funds',
  '054': 'Expired card',
  '055': 'Incorrect PIN',
  '057': 'Transaction not permitted to cardholder',
  '058': 'Transaction not permitted to terminal',
  '061': 'Exceeds withdrawal amount limit',
  '062': 'Restricted card',
  '065': 'Exceeds withdrawal frequency limit',
  '091': 'Card issuer unavailable – try again later',
  '096': 'System error – try again later',
}

// Callback from Tranzila after payment (hosted fields success_url / fail_url)
export async function POST(request: NextRequest) {
  const logId = Math.random().toString(36).substring(7)
  console.log(`[CALLBACK][${logId}] Tranzila callback received`)

  try {
    const formData = await request.formData()
    const params: Record<string, string> = {}

    formData.forEach((value, key) => {
      params[key] = value.toString()
    })

    console.log(`[CALLBACK][${logId}] Params received:`, JSON.stringify(params))

    const { Response: responseCode, index, ConfirmationCode } = params

    if (!index && !params.merchant_data) {
      console.error(`[CALLBACK][${logId}] Missing both index and merchant_data`)
      return NextResponse.json({ error: 'Missing transaction reference' }, { status: 400 })
    }

    const supabase = await createClient()

    const isSuccess = responseCode === '000'
    console.log(`[CALLBACK][${logId}] Response code: ${responseCode} | isSuccess: ${isSuccess}`)

    // Derive human-readable error before we lose the code
    const errorMsg = !isSuccess
      ? (TRANZILA_RESPONSE_CODES[responseCode] || `Payment declined (code: ${responseCode || 'unknown'})`)
      : undefined

    if (errorMsg) {
      console.log(`[CALLBACK][${logId}] Error message: ${errorMsg}`)
    }

    // Try to find the session ID from merchant_data first, fallback to index
    const sessionId = params.merchant_data || index

    console.log(`[CALLBACK][${logId}] Looking up session: ${sessionId}`)

    const { data: session, error: fetchError } = await supabase
      .from('payment_sessions')
      .select('*')
      .or(`id.eq.${sessionId},tranzila_transaction_id.eq.${sessionId}`)
      .single()

    if (fetchError || !session) {
      console.error(`[CALLBACK][${logId}] Session not found:`, fetchError, 'sessionId:', sessionId)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const actualSessionId = session.id
    console.log(`[CALLBACK][${logId}] Session found: ${actualSessionId} | current status: ${session.status}`)

    // Idempotency guard — don't reprocess an already-paid session
    if (session.status === 'paid') {
      console.log(`[CALLBACK][${logId}] Session already paid, returning success`)
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
      return breakoutRedirect(
        `${baseUrl}/checkout/success?session=${actualSessionId}&confirmation=${session.tranzila_transaction_id}`,
        actualSessionId
      )
    }

    let shopifyOrderId = session.order_id

    if (isSuccess && !shopifyOrderId && session.customer) {
      try {
        console.log(`[CALLBACK][${logId}] Creating Shopify order...`)
        const order = await createShopifyOrder({
          session: session as PaymentSession,
          customer: session.customer as CustomerInfo,
          transactionId: ConfirmationCode,
        })
        shopifyOrderId = String(order.id)
        console.log(`[CALLBACK][${logId}] Shopify order created: ${shopifyOrderId}`)
      } catch (err) {
        console.error(`[CALLBACK][${logId}] Shopify order failed (payment still marked paid):`, err)
      }
    }

    const { error: updateError } = await supabase
      .from('payment_sessions')
      .update({
        status: isSuccess ? 'paid' : 'failed',
        error_message: errorMsg ?? null,
        raw_response: params,
        order_id: shopifyOrderId,
        tranzila_transaction_id: ConfirmationCode || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', actualSessionId)

    if (updateError) {
      console.error(`[CALLBACK][${logId}] DB update failed:`, updateError)
      return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
    }

    console.log(`[CALLBACK][${logId}] Session updated to: ${isSuccess ? 'paid' : 'failed'}`)

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    const redirectUrl = isSuccess
      ? `${baseUrl}/checkout/success?session=${actualSessionId}&confirmation=${ConfirmationCode}`
      : `${baseUrl}/checkout/error?session=${actualSessionId}`

    return breakoutRedirect(redirectUrl, actualSessionId, errorMsg)
  } catch (error) {
    console.error(`[CALLBACK][${logId}] CRITICAL ERROR:`, error)
    return NextResponse.json({ error: 'Callback processing failed' }, { status: 500 })
  }
}

function breakoutRedirect(url: string, sessionId?: string, errorMessage?: string) {
  const safeError = (errorMessage || '').replace(/'/g, "\\'").replace(/"/g, '&quot;')
  return new NextResponse(
    `<html>
      <body>
        <script>
          try {
            var isSuccess = "${url}".includes('/checkout/success') || "${url}".includes('order_status_url') || "${url}".includes('/pages/success');
            var result = {
              type: '3DS_COMPLETE', // Reusing the same message type so the frontend listens to it
              success: isSuccess,
              url: "${url}",
              sessionId: "${sessionId || ''}",
              errorMessage: "${safeError}"
            };
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
        <p>Processing complete. Redirecting...</p>
      </body>
    </html>`,
    {
      headers: { 'Content-Type': 'text/html' },
    }
  )
}

export async function GET(request: NextRequest) {
  // Handle GET callback from Tranzila (some configurations use GET)
  const { searchParams } = new URL(request.url)
  const params: Record<string, string> = {}
  
  searchParams.forEach((value, key) => {
    params[key] = value
  })

  const formData = new FormData()
  Object.entries(params).forEach(([key, value]) => {
    formData.append(key, value)
  })

  // Reuse POST logic
  const postRequest = new NextRequest(request.url, {
    method: 'POST',
    body: formData,
  })

  return POST(postRequest)
}
