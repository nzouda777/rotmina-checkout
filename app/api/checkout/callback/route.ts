import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createShopifyOrder } from '@/lib/shopify'
import { sendOrderConfirmationEmail } from '@/lib/email'
import { sendMorningReceipt, detectPaymentMethod } from '@/lib/morning'
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
    console.log(`[CALLBACK][${logId}] Session found: ${actualSessionId} | current status: ${session.status} | order_id: ${session.order_id ?? 'none'}`)

    // Idempotency guard — if session is paid AND the Shopify order already exists, just redirect.
    // If paid but order_id is null (order creation failed on a previous attempt), fall through
    // and retry order creation so we don't permanently lose the order.
    if (session.status === 'paid' && session.order_id) {
      console.log(`[CALLBACK][${logId}] Session already paid with Shopify order ${session.order_id}, returning success`)
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
      return breakoutRedirect(
        `${baseUrl}/checkout/success?session=${actualSessionId}&confirmation=${session.tranzila_transaction_id}`,
        actualSessionId
      )
    }

    if (session.status === 'paid' && !session.order_id) {
      console.log(`[CALLBACK][${logId}] Session paid but Shopify order missing — retrying order creation`)
    }

    let shopifyOrderId = session.order_id
    let shopifyOrderUrl: string | null = null

    // Use the ConfirmationCode from this callback or fall back to the one already stored
    const txnId = ConfirmationCode || session.tranzila_transaction_id || `TZ-${Date.now()}`

    if (isSuccess ) {
      if (!session.customer) {
        console.error(`[CALLBACK][${logId}] Cannot create Shopify order: session.customer is null. Session data:`, JSON.stringify({ id: actualSessionId, status: session.status, cart_items: session.cart?.items?.length }))
      } else {
        try {
          console.log(`[CALLBACK][${logId}] Creating Shopify order | txnId: ${txnId}`)
          const order = await createShopifyOrder({
            session: session as PaymentSession,
            customer: session.customer as CustomerInfo,
            transactionId: txnId,
          })
          shopifyOrderId = String(order.id)
          shopifyOrderUrl = order.order_status_url || `https://${session.shop}/orders/${order.id}`
          console.log(`[CALLBACK][${logId}] ✅ Shopify order created: ${shopifyOrderId} | url: ${shopifyOrderUrl}`)

          // Persist order_id immediately so it is never lost if the full update below fails
          const { error: earlyOrderSaveError } = await supabase
            .from('payment_sessions')
            .update({ order_id: shopifyOrderId, updated_at: new Date().toISOString() })
            .eq('id', actualSessionId)
          if (earlyOrderSaveError) {
            console.error(`[CALLBACK][${logId}] ⚠️ Early order_id save failed (non-fatal):`, earlyOrderSaveError)
          } else {
            console.log(`[CALLBACK][${logId}] order_id saved early: ${shopifyOrderId}`)
          }

          // Send confirmation email (non-blocking)
          const customer = session.customer as CustomerInfo
          sendOrderConfirmationEmail({
            toEmail:      customer.email,
            orderName:    String(order.name || order.id),
            customerName: `${customer.firstName} ${customer.lastName}`,
            items: (session.cart?.items || []).map((item: any) => ({
              title:    item.title,
              quantity: item.quantity,
              price:    item.price,
              image:    item.image,
            })),
            subtotal:  session.cart?.subtotal,
            shipping:  session.cart?.shipping,
            tax:       session.cart?.tax,
            total:     session.cart?.total,
            currency:  session.cart?.currency,
            shippingAddress: {
              address:    customer.address,
              city:       customer.city,
              postalCode: customer.postalCode,
              country:    customer.country,
            },
            orderStatusUrl: shopifyOrderUrl ?? undefined,
          }).catch((emailErr: any) =>
            console.error(`[CALLBACK][${logId}] Email send failed (non-fatal):`, emailErr)
          )

          // Send Morning Receipt (non-blocking)
          sendMorningReceipt({
            customerEmail: customer.email,
            customerName: `${customer.firstName} ${customer.lastName}`,
            amount: Number(session.cart?.total || 0),
            currency: session.cart?.currency,
            paymentMethod: detectPaymentMethod(session.raw_response),
            items: (session.cart?.items || []).map((item: any) => ({
              description: item.title,
              quantity: item.quantity,
              price: Number(item.price),
            })),
          }).catch((morningErr: any) =>
            console.error(`[CALLBACK][${logId}] Morning receipt failed (non-fatal):`, morningErr)
          )
        } catch (err: any) {
          console.error(`[CALLBACK][${logId}] ❌ Shopify order creation failed:`, err?.message || err)
          // shopifyOrderId stays null — session will be marked paid without order_id.
          // Next callback call will retry because idempotency guard now checks order_id too.
        }
      }
    }

    const { error: updateError } = await supabase
      .from('payment_sessions')
      .update({
        status: isSuccess ? 'paid' : 'failed',
        error_message: errorMsg ?? null,
        raw_response: {
          ...params,
          shopifyOrderUrl: shopifyOrderUrl || undefined,
          _gift_card: (session.raw_response as any)?._gift_card || undefined,
        },
        order_id: shopifyOrderId,
        tranzila_transaction_id: txnId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', actualSessionId)

    if (updateError) {
      console.error(`[CALLBACK][${logId}] DB update failed:`, updateError)
      return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
    }

    console.log(`[CALLBACK][${logId}] Session updated to: ${isSuccess ? 'paid' : 'failed'} | order_id: ${shopifyOrderId ?? 'none'}`)

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    const redirectUrl = isSuccess
      ? (shopifyOrderUrl || `https://${session.shop}/pages/success?session=${actualSessionId}`)
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
              type: '3DS_COMPLETE',
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
              // Preserve the language setting so the success/error page renders in the right language
              var destUrl = "${url}";
              try {
                var savedLang = localStorage.getItem('rotmina-lang');
                if (savedLang === 'en' || savedLang === 'he') {
                  destUrl += (destUrl.indexOf('?') !== -1 ? '&' : '?') + 'language=' + savedLang;
                }
              } catch(le) {}
              window.location.href = destUrl;
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
