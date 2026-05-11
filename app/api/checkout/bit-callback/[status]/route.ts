import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createShopifyOrder } from '@/lib/shopify'
import { debitGiftCard } from '@/lib/gift-cards'
import { sendOrderConfirmationEmail } from '@/lib/email'
import type { PaymentSession, CustomerInfo, GiftCardInfo } from '@/lib/types'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ status: string }> }
) {
  const { status } = await params
  return handleBitCallback(request, status)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ status: string }> }
) {
  const { status } = await params
  return handleBitCallback(request, status)
}

async function handleBitCallback(request: NextRequest, status: string) {
  const logId = Math.random().toString(36).substring(7)
  const { searchParams } = new URL(request.url)

  let sessionId = searchParams.get('merchant_data')
  let confirmationCode =
    searchParams.get('index') ||
    searchParams.get('ConfirmationCode') ||
    searchParams.get('confirmation_code')

  // Customer info extracted from the Tranzila webhook body (fallback when session.customer is null)
  let callbackCustomer: CustomerInfo | null = null

  // Log and parse POST body if present (Tranzila sends webhook data in POST body)
  if (request.method === 'POST') {
    try {
      const formData = await request.formData()
      if (!sessionId) {
        sessionId = formData.get('merchant_data') as string
      }
      if (!confirmationCode) {
        confirmationCode =
          (formData.get('index') as string) ||
          (formData.get('ConfirmationCode') as string) ||
          (formData.get('confirmation_code') as string)
      }

      const bodyObj: Record<string, string> = {}
      formData.forEach((value, key) => { bodyObj[key] = value.toString() })
      console.log(`[BIT-CALLBACK][${logId}] POST body:`, JSON.stringify(bodyObj))

      // Extract customer info from callback body as fallback.
      // Tranzila echoes back contact/email/phone that were passed at charge time.
      const contact = (formData.get('contact') as string) || ''
      const email = (formData.get('email') as string) || ''
      const phone = (formData.get('phone') as string) || ''
      if (email || contact) {
        const nameParts = contact.trim().split(/\s+/)
        callbackCustomer = {
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
          email,
          phone,
          address: '',
          city: '',
          postalCode: '',
          country: 'Israel',
        }
      }
    } catch (err) {
      console.error(`[BIT-CALLBACK][${logId}] Error parsing POST body:`, err)
    }
  }

  confirmationCode = confirmationCode || `BIT-${Date.now()}`

  console.log(`[BIT-CALLBACK][${logId}] status=${status} sessionId=${sessionId} confirmationCode=${confirmationCode}`)
  console.log(`[BIT-CALLBACK][${logId}] Full URL: ${request.url}`)

  // ── Handle the notify_url webhook (server-to-server from Tranzila) ────────
  // Tranzila calls notify_url when the payment is confirmed on their end.
  // We MUST NOT fail the session here — instead update to paid.
  if (status === 'notify') {
    console.log(`[BIT-CALLBACK][${logId}] notify_url webhook received`)
    if (!sessionId) {
      console.warn(`[BIT-CALLBACK][${logId}] notify: no sessionId, ignoring`)
      return NextResponse.json({ ok: true })
    }
    const supabase = await createClient()
    const { data: session } = await supabase
      .from('payment_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (!session) {
      console.warn(`[BIT-CALLBACK][${logId}] notify: session not found`)
      return NextResponse.json({ ok: true })
    }

    if (session.status === 'paid' && session.order_id) {
      console.log(`[BIT-CALLBACK][${logId}] notify: already paid with order ${session.order_id}, no-op`)
      return NextResponse.json({ ok: true })
    }

    if (session.status === 'paid' && !session.order_id) {
      console.log(`[BIT-CALLBACK][${logId}] notify: session paid but Shopify order missing — retrying order creation`)
    }

    console.log(`[BIT-CALLBACK][${logId}] notify: processing payment for session ${sessionId}`)
    // Process as success — the notify webhook confirms the payment
    await processSuccess(supabase, session, sessionId, confirmationCode, logId, callbackCustomer)
    return NextResponse.json({ ok: true })
  }

  // ── Handle failure callback ────────────────────────────────────────────────
  if (status === 'failure' || status === 'cancel') {
    console.log(`[BIT-CALLBACK][${logId}] Bit payment ${status}`)
    if (!sessionId) return redirectToErrorUrl(request, 'Session ID missing')

    const supabase = await createClient()
    await supabase
      .from('payment_sessions')
      .update({ status: 'failed', error_message: `Bit payment ${status}` })
      .eq('id', sessionId)

    return redirectToErrorUrl(request, `Bit payment was ${status}.`, sessionId)
  }

  // ── Handle success callback (browser redirect from Tranzila) ─────────────
  if (!sessionId) {
    console.error(`[BIT-CALLBACK][${logId}] success: missing sessionId`)
    return redirectToErrorUrl(request, 'Session ID missing')
  }

  const supabase = await createClient()
  const { data: session, error } = await supabase
    .from('payment_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (error || !session) {
    console.error(`[BIT-CALLBACK][${logId}] Session not found: ${sessionId}`)
    return redirectToErrorUrl(request, 'Session not found')
  }

  if (session.status === 'paid' && session.order_id) {
    console.log(`[BIT-CALLBACK][${logId}] Already paid with order ${session.order_id} — returning success`)
    return redirectToSuccessUrl(request, session, confirmationCode)
  }

  if (session.status === 'paid' && !session.order_id) {
    console.log(`[BIT-CALLBACK][${logId}] Session paid but Shopify order missing — retrying order creation`)
  }

  console.log(`[BIT-CALLBACK][${logId}] Processing Bit success for session ${sessionId}`)
  await processSuccess(supabase, session, sessionId, confirmationCode, logId, callbackCustomer)
  return redirectToSuccessUrl(request, session, confirmationCode)
}

// ── Shared success processor ──────────────────────────────────────────────────
async function processSuccess(
  supabase: any,
  session: any,
  sessionId: string,
  confirmationCode: string,
  logId: string,
  callbackCustomer: CustomerInfo | null = null,
) {
  const actualSessionId = session.id
  const customer = (session.customer as CustomerInfo) || callbackCustomer
  const storedGiftCard = session.raw_response?._gift_card
  let remainingBalance: number | undefined

  // 1. Debit gift card if applicable
  if (storedGiftCard?.code && storedGiftCard?.appliedAmount > 0) {
    try {
      console.log(`[BIT-CALLBACK][${logId}] Debiting gift card ${storedGiftCard.code}`)
      const updatedCard = await debitGiftCard({
        code: storedGiftCard.code,
        amount: storedGiftCard.appliedAmount,
        sessionId,
      })
      remainingBalance = updatedCard.balance
      console.log(`[BIT-CALLBACK][${logId}] Gift card debited — remaining: ${remainingBalance}`)
    } catch (gcErr) {
      console.error(`[BIT-CALLBACK][${logId}] GC debit failed:`, gcErr)
    }
  }

  // 2. Create Shopify order (only if not already done)
  let shopifyOrderId = session.order_id
  let shopifyOrderUrl: string | null = null

  if (!shopifyOrderId) {
    if (!customer) {
      console.error(`[BIT-CALLBACK][${logId}] Customer info missing — cannot create Shopify order. Session: ${session.id}`)
      // Do not throw — still mark session paid so the customer isn't stuck
    } else {
      const giftCardInfo: GiftCardInfo | undefined = storedGiftCard
        ? {
            id: storedGiftCard.id || '',
            code: storedGiftCard.code,
            balance: storedGiftCard.appliedAmount,
            currency: session.cart?.currency || 'ILS',
            appliedAmount: storedGiftCard.appliedAmount,
          }
        : undefined

      try {
        console.log(`[BIT-CALLBACK][${logId}] Creating Shopify order | confirmationCode: ${confirmationCode}`)
        const order = await createShopifyOrder({
          session: session as PaymentSession,
          customer,
          transactionId: confirmationCode,
          giftCard: giftCardInfo,
        })
        shopifyOrderId = String(order.id)
        shopifyOrderUrl = order.order_status_url || `https://${session.shop}/orders/${order.id}`
        console.log(`[BIT-CALLBACK][${logId}] ✅ Shopify order created: ${shopifyOrderId}`)

        // 3. Send confirmation email (non-blocking — failure should not abort session update)
        sendOrderConfirmationEmail({
          toEmail: customer.email,
          orderName: String(order.name || order.id),
          customerName: `${customer.firstName} ${customer.lastName}`,
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
            address: customer.address,
            city: customer.city,
            postalCode: customer.postalCode,
            country: customer.country,
          },
          orderStatusUrl: shopifyOrderUrl || undefined,
        }).catch((emailErr: any) =>
          console.error(`[BIT-CALLBACK][${logId}] Email send failed (non-fatal):`, emailErr)
        )
      } catch (orderErr: any) {
        console.error(`[BIT-CALLBACK][${logId}] ❌ Shopify order creation failed:`, orderErr.message)
        // shopifyOrderId stays null — next callback call will retry (idempotency guard checks order_id)
      }
    }
  } else {
    console.log(`[BIT-CALLBACK][${logId}] Shopify order already exists: ${shopifyOrderId}`)
  }

  // 4. Update session to paid — this triggers Supabase realtime on the frontend
  const { error: updateErr } = await supabase
    .from('payment_sessions')
    .update({
      status: 'paid',
      order_id: shopifyOrderId,
      tranzila_transaction_id: confirmationCode,
      error_message: null,
      raw_response: {
        ...session.raw_response,
        bit_callback_status: 'success',
        confirmation_code: confirmationCode,
        shopifyOrderUrl,
        _gift_card: storedGiftCard
          ? { ...storedGiftCard, remainingBalance }
          : null,
      },
    })
    .eq('id', actualSessionId)

  if (updateErr) {
    console.error(`[BIT-CALLBACK][${logId}] DB update failed:`, updateErr)
  } else {
    console.log(`[BIT-CALLBACK][${logId}] ✅ Session ${actualSessionId} → paid`)
  }
  
  return shopifyOrderId
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function redirectToSuccessUrl(request: NextRequest, session: any, confirmationCode: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const targetUrl = `${baseUrl}/checkout/success?session=${session.id}&confirmation=${confirmationCode}`
  return breakoutRedirect(targetUrl, session.id)
}

function redirectToErrorUrl(request: NextRequest, message: string, sessionId?: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const targetUrl = `${baseUrl}/checkout/error?session=${sessionId || ''}&error=${encodeURIComponent(message)}`
  return breakoutRedirect(targetUrl, sessionId, message)
}

function breakoutRedirect(url: string, sessionId?: string, errorMessage?: string) {
  const safeUrl = url.replace(/"/g, '&quot;').replace(/'/g, "\\'")
  const safeError = (errorMessage || '').replace(/'/g, "\\'").replace(/"/g, '&quot;')
  const safeSession = (sessionId || '').replace(/"/g, '')
  const isSuccess =
    url.includes('/checkout/success') ||
    url.includes('order_status_url') ||
    url.includes('/pages/success')

  return new NextResponse(
    `<html>
      <head><title>${isSuccess ? 'Payment confirmed' : 'Payment failed'}</title></head>
      <body>
        <script>
          (function() {
            var result = {
              type: '3DS_COMPLETE',
              success: ${isSuccess},
              url: "${safeUrl}",
              sessionId: "${safeSession}",
              errorMessage: "${safeError}"
            };
            console.log('[BIT-BREAKOUT] Sending postMessage:', JSON.stringify(result));
            try {
              if (window.parent && window.parent !== window) {
                window.parent.postMessage(result, '*');
                console.log('[BIT-BREAKOUT] postMessage sent to parent');
              } else if (window.opener) {
                window.opener.postMessage(result, '*');
                console.log('[BIT-BREAKOUT] postMessage sent to opener');
                window.close();
              } else {
                console.log('[BIT-BREAKOUT] No parent/opener, redirecting directly');
                window.location.href = "${safeUrl}";
              }
            } catch(e) {
              console.error('[BIT-BREAKOUT] Error:', e);
              window.location.href = "${safeUrl}";
            }
          })();
        </script>
        <p style="font-family:sans-serif;text-align:center;margin-top:40px">
          ${isSuccess ? 'Payment confirmed. Redirecting...' : 'Processing...'}
        </p>
      </body>
    </html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
