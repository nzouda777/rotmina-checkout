import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createShopifyOrder } from '@/lib/shopify'
import { debitGiftCard, generateGiftCardsForOrder } from '@/lib/gift-cards'
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
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('merchant_data')
  const confirmationCode = searchParams.get('index') || searchParams.get('ConfirmationCode') || 'BIT-CONFIRMED'

  console.log(`[BIT-CALLBACK] Status: ${status}, Session: ${sessionId}`)

  if (!sessionId) {
    return redirectToError('Session ID missing')
  }

  const supabase = await createClient()
  const { data: session, error } = await supabase
    .from('payment_sessions')
    .select('*')
    .or(`id.eq.${sessionId},tranzila_transaction_id.eq.${sessionId}`)
    .single()

  if (error || !session) {
    return redirectToError('Session not found')
  }

  const actualSessionId = session.id

  if (status !== 'success') {
    await supabase
      .from('payment_sessions')
      .update({ status: 'failed', error_message: 'Bit payment was not completed' })
      .eq('id', actualSessionId)
    return redirectToError('Le paiement Bit a échoué ou a été annulé.', sessionId)
  }

  if (session.status === 'paid') {
    return redirectToShopify(session)
  }

  // Bit payment Success - Process Order
  try {
    const storedGiftCard = session.raw_response?._gift_card
    let remainingBalance: number | undefined

    // 1. Debit gift card if applicable
    if (storedGiftCard?.code && storedGiftCard?.appliedAmount > 0) {
      try {
        const updatedCard = await debitGiftCard({
          code: storedGiftCard.code,
          amount: storedGiftCard.appliedAmount,
          sessionId,
        })
        remainingBalance = updatedCard.balance
      } catch (gcErr) {
        console.error('[BIT-CALLBACK] GC debit failed:', gcErr)
      }
    }

    // 2. Create Shopify Order
    let shopifyOrderId = session.order_id
    let shopifyOrderUrl = null
    const customer = session.customer as CustomerInfo

    if (!shopifyOrderId) {
      const giftCardInfo: GiftCardInfo | undefined = storedGiftCard ? {
        id: storedGiftCard.id || '',
        code: storedGiftCard.code,
        balance: storedGiftCard.appliedAmount,
        currency: session.cart?.currency || 'ILS',
        appliedAmount: storedGiftCard.appliedAmount,
      } : undefined

      const order = await createShopifyOrder({
        session: session as PaymentSession,
        customer,
        transactionId: confirmationCode,
        giftCard: giftCardInfo,
      })
      shopifyOrderId = String(order.id)
      shopifyOrderUrl = order.order_status_url || `https://${session.shop}/orders/${order.id}`

      // 3. Send Email
      try {
        await sendOrderConfirmationEmail({
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
          orderStatusUrl: shopifyOrderUrl,
        })
      } catch (e) {}
    }

    // 4. Update session
    await supabase
      .from('payment_sessions')
      .update({
        status: 'paid',
        order_id: shopifyOrderId,
        tranzila_transaction_id: confirmationCode,
        raw_response: {
          ...session.raw_response,
          bit_callback_status: 'success',
          confirmation_code: confirmationCode,
          shopifyOrderUrl: shopifyOrderUrl, // Save URL for frontend polling
        }
      })
      .eq('id', actualSessionId)

    return redirectToShopify(session, shopifyOrderId)

  } catch (err: any) {
    console.error('[BIT-CALLBACK] Error:', err)
    return redirectToError('Une erreur est survenue lors de la validation de votre commande.')
  }
}

function redirectToShopify(session: any, shopifyOrderId?: string | null) {
  const shopifyDomain = session.shop || 'rotmina.myshopify.com'
  const targetUrl = `https://${shopifyDomain}/pages/success${shopifyOrderId ? `?order_id=${shopifyOrderId}` : ''}`
  return breakoutRedirect(targetUrl, session.id)
}

function redirectToError(message: string, sessionId?: string, shop?: string) {
  const shopifyDomain = shop || 'rotmina.myshopify.com'
  const targetUrl = `https://${shopifyDomain}/pages/error?error=${encodeURIComponent(message)}`
  return breakoutRedirect(targetUrl, sessionId, message)
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
              window.location.href = "${url}";
            }
          } catch(e) {
            window.location.href = "${url}";
          }
        </script>
        <p>Verification complete. Processing...</p>
      </body>
    </html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
