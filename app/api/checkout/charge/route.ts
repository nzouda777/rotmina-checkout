import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import { debitGiftCard, generateGiftCardsForOrder } from '@/lib/gift-cards'
import { sendOrderConfirmationEmail } from '@/lib/email'
import type { PaymentSession, CustomerInfo, GiftCardInfo } from '@/lib/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getIsoCountryCode(country: string): string {
  const mapping: Record<string, string> = {
    'Israel': 'IL',
    'Jordan': 'JO',
    'Egypt': 'EG',
    'Cyprus': 'CY',
    'Saudi Arabia': 'SA',
    'United Arab Emirates': 'AE',
    'United States': 'US',
    'United Kingdom': 'GB',
    'France': 'FR',
    'Canada': 'CA',
    'Australia': 'AU',
    'Germany': 'DE',
  }
  return mapping[country] || country
}

function sanitizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

// ─── Post-payment tasks ───────────────────────────────────────────────────────

interface PostPaymentResult {
  debitSuccess: boolean
  generatedCards: any[]
  giftCardRemainingBalance?: number
}

async function handlePostPayment(params: {
  logId: string
  session: any
  sessionId: string
  customerInfo: CustomerInfo
  giftCardCode?: string
  giftCardAmount?: number
  transactionId?: string
  shopifyOrderId?: string
}): Promise<PostPaymentResult> {
  const { logId, session, sessionId, customerInfo, giftCardCode, giftCardAmount, transactionId, shopifyOrderId } = params
  const results: PostPaymentResult = { debitSuccess: true, generatedCards: [] }

  // 1. Debit gift card if used as payment
  if (giftCardCode && giftCardAmount && giftCardAmount > 0) {
    try {
      console.log(`[CHARGE][${logId}] Debiting gift card ${giftCardCode} for ${giftCardAmount}...`)
      const updatedCard = await debitGiftCard({ code: giftCardCode, amount: giftCardAmount, sessionId })
      results.giftCardRemainingBalance = updatedCard.balance
      console.log(`[CHARGE][${logId}] Gift card debited successfully`)
    } catch (gcError) {
      console.error(`[CHARGE][${logId}] WARNING: Payment succeeded but gift card debit failed:`, gcError)
      results.debitSuccess = false
    }
  }

  // 2. Generate gift card codes if cart contains gift card products
  try {
    const generatedCards = await generateGiftCardsForOrder({
      items: session.cart.items || [],
      sessionId,
      orderId: shopifyOrderId,
      buyerEmail: customerInfo.email,
      currency: session.cart.currency,
    })
    results.generatedCards = generatedCards
    if (generatedCards.length > 0) {
      console.log(`[CHARGE][${logId}] Generated ${generatedCards.length} gift card(s):`, generatedCards.map(c => c.code))
    }
  } catch (err) {
    console.error(`[CHARGE][${logId}] CRITICAL ERROR during gift card generation:`, err)
  }

  return results
}

// ─── Shopify order creation + confirmation email ──────────────────────────────

async function createOrderAndNotify(params: {
  logId: string
  session: any
  customerInfo: CustomerInfo
  transactionId: string
  giftCardInfo?: GiftCardInfo
}): Promise<{ shopifyOrderId: string; shopifyOrderUrl: string }> {
  const { logId, session, customerInfo, transactionId, giftCardInfo } = params

  console.log(`[CHARGE][${logId}] Creating Shopify order...`)
  const order = await createShopifyOrder({
    session: session as PaymentSession,
    customer: customerInfo,
    transactionId,
    giftCard: giftCardInfo,
  })
  const shopifyOrderId = String(order.id)
  const shopifyDomain = session.shop || 'rotmina.myshopify.com'
  const shopifyOrderUrl = order.order_status_url || `https://${shopifyDomain}/pages/success?order_id=${shopifyOrderId}`
  console.log(`[CHARGE][${logId}] Shopify order created: ${shopifyOrderId}`)

  // Send confirmation email (non-blocking — failure is logged, not thrown)
  try {
    console.log(`[CHARGE][${logId}] Sending order confirmation email...`)
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
    console.error(`[CHARGE][${logId}] Failed to send order confirmation email:`, emailErr)
  }

  return { shopifyOrderId, shopifyOrderUrl }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const logId = Math.random().toString(36).substring(7)
  console.log(`[CHARGE][${logId}] Request started`)

  try {
    const body = await request.json()
    const {
      sessionId,
      customerInfo,
      cardNumber,
      expiryDate,
      cvv,
      cardholderName,
      browserData,
      installments = 1,
      paymentMethod = 'card',
      giftCardId,
      giftCardCode,
      giftCardAmount = 0,
    } = body

    console.log(`[CHARGE][${logId}] Session: ${sessionId} | Method: ${paymentMethod}`)
    console.log(`[CHARGE][${logId}] Gift card: Code=${giftCardCode || 'none'}, Amount=${giftCardAmount}`)

    if (!sessionId || !customerInfo) {
      return NextResponse.json({ error: 'Missing required payment information' }, { status: 400 })
    }

    const supabase = await createClient()

    // ── Fetch & validate session ──────────────────────────────────
    const { data: session, error: sessionError } = await supabase
      .from('payment_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      console.error(`[CHARGE][${logId}] Session not found:`, sessionError)
      return NextResponse.json({ error: 'Payment session not found' }, { status: 404 })
    }

    console.log(`[CHARGE][${logId}] Session status: ${session.status}`)

    if (session.status === 'paid' || session.status === 'processing') {
      return NextResponse.json(
        { error: 'Payment session already processed or is currently processing' },
        { status: 400 }
      )
    }

    // Lock session to prevent duplicate charges
    await supabase
      .from('payment_sessions')
      .update({ status: 'processing', error_message: null, customer: customerInfo as CustomerInfo })
      .eq('id', sessionId)

    // ── Amount calculation ────────────────────────────────────────
    const orderTotal = Number(session.cart.total)
    const validGiftCardAmount = Math.min(Number(giftCardAmount) || 0, orderTotal)
    const chargeAmount = Math.max(orderTotal - validGiftCardAmount, 0)

    console.log(`[CHARGE][${logId}] Total: ${orderTotal} | GC: ${validGiftCardAmount} | CC charge: ${chargeAmount}`)

    let giftCardInfo: GiftCardInfo | undefined
    if (giftCardCode && validGiftCardAmount > 0) {
      giftCardInfo = {
        id: giftCardId || '',
        code: giftCardCode,
        balance: validGiftCardAmount,
        currency: session.cart.currency,
        appliedAmount: validGiftCardAmount,
      }
    }

    // ── Detect test card ──────────────────────────────────────────
    // NOTE: test-card detection should only be active in non-production environments
    const isTestCard =
      process.env.NODE_ENV !== 'production' &&
      cardNumber?.replace(/\s/g, '') === '5430050220380520'

    // ── Case A: Gift card covers entire amount OR test card ───────
    if (chargeAmount <= 0 || isTestCard) {
      const txnId = isTestCard ? `TEST-${Date.now()}` : `GC-${giftCardCode}`
      console.log(`[CHARGE][${logId}] ${isTestCard ? 'Test card' : 'GC covers full order'} → txnId: ${txnId}`)

      const postPayment = await handlePostPayment({
        logId, session, sessionId, customerInfo,
        giftCardCode, giftCardAmount: validGiftCardAmount,
        transactionId: txnId,
      })

      if (!postPayment.debitSuccess) {
        await supabase
          .from('payment_sessions')
          .update({ status: 'failed', error_message: 'Failed to process gift card payment' })
          .eq('id', sessionId)
        return NextResponse.json(
          { success: false, error: 'Failed to process gift card payment. Please try again.' },
          { status: 500 }
        )
      }

      let shopifyOrderId = session.order_id
      let shopifyOrderUrl: string | undefined

      try {
        const orderResult = await createOrderAndNotify({
          logId, session, customerInfo, transactionId: txnId, giftCardInfo,
        })
        shopifyOrderId = orderResult.shopifyOrderId
        shopifyOrderUrl = orderResult.shopifyOrderUrl
      } catch (err) {
        console.error(`[CHARGE][${logId}] Failed to create Shopify order:`, err)
      }

      await supabase
        .from('payment_sessions')
        .update({
          status: 'paid',
          order_id: shopifyOrderId,
          tranzila_transaction_id: txnId,
          raw_response: {
            payment_method: isTestCard ? 'test_card' : 'gift_card_only',
            gift_card_code: giftCardCode,
            gift_card_amount: validGiftCardAmount,
            gift_card_remaining_balance: postPayment.giftCardRemainingBalance,
            generated_gift_cards: postPayment.generatedCards.map(c => ({
              code: c.code, amount: c.original_amount, currency: c.currency,
            })),
          } as any,
        })
        .eq('id', sessionId)

      return NextResponse.json({
        success: true,
        confirmationCode: txnId,
        giftCardAmount: validGiftCardAmount,
        giftCardRemainingBalance: postPayment.giftCardRemainingBalance,
        generatedGiftCards: postPayment.generatedCards.map(c => ({
          code: c.code, amount: c.original_amount, currency: c.currency,
        })),
        shopifyOrderUrl,
      })
    }

    // ── Case B: Credit card or Bit payment required ───────────────
    // For SAQ A, we no longer check for cardNumber, expiryDate, cvv here
    // because they will be entered securely inside the Tranzila Iframe.
    if (paymentMethod === 'card' && !chargeAmount) {
      await supabase.from('payment_sessions').update({ status: 'pending' }).eq('id', sessionId)
      return NextResponse.json({ error: 'Invalid charge amount' }, { status: 400 })
    }

    const tranzila = createTranzilaClient()
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1'

    // Build Tranzila items list
    const tranzilaItems = (session.cart.items || []).map((item: any) => ({
      name: String(item.title || 'Product'),
      unit_price: Number(item.price),
      units_number: Number(item.quantity) || 1,
      unit_type: 1,
      type: 'I',
      currency_code: session.cart.currency.toUpperCase(),
    }))

    if (tranzilaItems.length === 0) {
      tranzilaItems.push({
        name: `Order from ${session.shop}`,
        unit_price: Number(chargeAmount),
        units_number: 1,
        unit_type: 1,
        type: 'I',
        currency_code: session.cart.currency.toUpperCase(),
      })
    }

    // Add gift card discount line
    if (validGiftCardAmount > 0) {
      tranzilaItems.push({
        name: `Gift Card ${giftCardCode}`,
        unit_price: -Number(validGiftCardAmount),
        units_number: 1,
        unit_type: 1,
        type: 'I',
        currency_code: session.cart.currency.toUpperCase(),
      })
    }

    // ── Case B1: Bit payment ──────────────────────────────────────
    if (paymentMethod === 'bit') {
      const callbackUrl = `${baseUrl}/api/checkout/bit-callback`
      console.log(`[CHARGE][${logId}] Initiating Bit payment | callback: ${callbackUrl}`)

      const bitItems = tranzilaItems.map((item: any) => ({
        code: item.code || '',
        name: item.name,
        type: 'I',
        units_number: Number(item.units_number),
        unit_type: 1,
        unit_price: Number(item.unit_price),
        price_type: 'G',
        currency_code: session.cart.currency.toUpperCase(),
        to_txn_currency_exchange_rate: 1,
      }))

      const bitPayload = {
        terminal_name: process.env.TRANZILA_TERMINAL || '',
        txn_currency_code: session.cart.currency.toUpperCase(),
        txn_type: 'debit',
        success_url: `${callbackUrl}/success?merchant_data=${sessionId}`,
        failure_url: `${callbackUrl}/failure?merchant_data=${sessionId}`,
        notify_url: `${callbackUrl}/notify?merchant_data=${sessionId}`,
        client: {
          name: `${customerInfo.firstName} ${customerInfo.lastName}`,
          email: customerInfo.email,
          address_line_1: customerInfo.address,
          city: customerInfo.city,
          zip: customerInfo.postalCode || '',
          phone: sanitizePhone(customerInfo.phone),
        },
        items: bitItems,
        response_language: 'english',
        created_by_system: 'rotmani-checkout',
      }

      try {
        const bitResponse = await tranzila.initBit(bitPayload)
        console.log(`[CHARGE][${logId}] Bit API response received`)

        const redirectUrl = bitResponse.bit_url || bitResponse.sale_url

        if (!redirectUrl) {
          throw new Error(bitResponse.message || bitResponse.error || 'Failed to get Bit payment URL')
        }

        console.log(`[CHARGE][${logId}] Bit URL obtained successfully`)

        await supabase
          .from('payment_sessions')
          .update({
            status: 'pending_bit',
            raw_response: {
              ...bitResponse,
              _gift_card: giftCardInfo ? {
                id: giftCardInfo.id,
                code: giftCardInfo.code,
                appliedAmount: giftCardInfo.appliedAmount,
              } : null,
            },
          })
          .eq('id', sessionId)

        return NextResponse.json({
          success: false,
          requiresRedirect: true,   // ← renamed from requires3DS to avoid confusion
          redirectUrl,
          sessionId,
          paymentMethod: 'bit',
        })
      } catch (bitErr: any) {
        console.error(`[CHARGE][${logId}] Bit init failed:`, bitErr.message)
        await supabase
          .from('payment_sessions')
          .update({ status: 'failed', error_message: bitErr.message })
          .eq('id', sessionId)
        return NextResponse.json(
          { success: false, error: bitErr.message || 'Bit initialization failed' },
          { status: 500 }
        )
      }
    }

    // ── Case B2: Credit card (Tranzila Hosted Fields SAQ A) ────────────────────────────
    if (paymentMethod === 'card') {
      console.log(`[CHARGE][${logId}] Generating Tranzila params for Hosted Fields Credit Card`)
      const callbackUrl = `${baseUrl}/api/checkout/callback`

      const thtk = await tranzila.getHandshakeToken(chargeAmount)
      const terminal = process.env.TRANZILA_TERMINAL || ''

      await supabase
        .from('payment_sessions')
        .update({
          status: 'pending_3ds', // We reuse pending_3ds to indicate waiting for Tranzila processing
          raw_response: {
            hosted_fields_initiated: true,
            _gift_card: giftCardInfo
              ? { id: giftCardInfo.id, code: giftCardInfo.code, appliedAmount: giftCardInfo.appliedAmount }
              : null,
          },
        })
        .eq('id', sessionId)

      return NextResponse.json({
        success: false,
        requiresHostedFields: true,
        thtk,
        terminal,
        chargeAmount,
        currency: session.cart.currency.toUpperCase() === 'USD' ? '2' : '1',
        callbackUrl,
        sessionId,
        paymentMethod: 'card',
      })
    }

  } catch (error: any) {
    console.error(`[CHARGE] CRITICAL ERROR:`, error)
    return NextResponse.json(
      { error: 'Payment processing failed', detail: error.message },
      { status: 500 }
    )
  }
}