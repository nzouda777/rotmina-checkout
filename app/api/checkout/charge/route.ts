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
    if (paymentMethod === 'card' && (!cardNumber || !expiryDate || !cvv)) {
      await supabase.from('payment_sessions').update({ status: 'pending' }).eq('id', sessionId)
      return NextResponse.json({ error: 'Missing required credit card information' }, { status: 400 })
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

    // ── Case B2: Credit card with 3DS ────────────────────────────
    const callbackUrl = `${baseUrl}/api/checkout/3ds-callback`

    const [month, year] = expiryDate.split('/')
    const expireMonth = parseInt(month, 10)
    const expireYear = parseInt(`20${year}`, 10)

    // Installment calculation
    let payment_plan = 1
    let tranzilaInstallments = {}

    if (installments > 1) {
      payment_plan = 8
      const otherAmount = Math.floor((chargeAmount / installments) * 100) / 100
      const firstAmount = chargeAmount - otherAmount * (installments - 1)
      tranzilaInstallments = {
        installments_number: installments,
        first_installment_amount: Number(firstAmount.toFixed(2)),
        other_installments_amount: Number(otherAmount.toFixed(2)),
      }
      console.log(`[CHARGE][${logId}] Installments: ${installments}x | First: ${firstAmount.toFixed(2)} | Others: ${otherAmount.toFixed(2)}`)
    }

    const chargePayload = {
      terminal_name: process.env.TRANZILA_TERMINAL || '',
      txn_currency_code: session.cart.currency.toUpperCase(),
      items: tranzilaItems,
      txn_type: 'debit',
      expire_month: Number(expireMonth),
      expire_year: Number(expireYear),
      cvv: String(cvv),
      card_number: String(cardNumber!.replace(/\s/g, '')),
      payment_plan,
      ...tranzilaInstallments,
      activate_3ds: 'Y',
      '3ds_settings': {
        browser: { ...browserData, ip: clientIp },
        force_txn_on_3ds_fail: 'Y',
        force_challenge: 0,
        auth_3ds_redirect: {
          url: `${callbackUrl}?merchant_data=${sessionId}`,
        },
      },
      client: {
        email: customerInfo.email,
        name: cardholderName || `${customerInfo.firstName} ${customerInfo.lastName}`,
        address_line_1: customerInfo.address,
        city: customerInfo.city,
        phone_number: sanitizePhone(customerInfo.phone),
        country_code: getIsoCountryCode(customerInfo.country || 'Israel'),
        zip: customerInfo.postalCode || '',
      },
    }

    console.log(`[CHARGE][${logId}] Calling Tranzila (charging ${chargeAmount} ${session.cart.currency})...`)
    const tranzilaResponse = await tranzila.charge(chargePayload)
    console.log(`[CHARGE][${logId}] Tranzila response keys:`, Object.keys(tranzilaResponse))

    // ─────────────────────────────────────────────────────────────────────────
    // IMPORTANT: Check for 3DS redirect URL FIRST, before evaluating isSuccess.
    //
    // When 3DS authentication is required, Tranzila returns a challengeUrl but
    // the transaction is NOT yet approved — so isSuccess is false at this stage.
    // Checking isSuccess first would incorrectly reject a valid pending 3DS flow.
    // ─────────────────────────────────────────────────────────────────────────
    const tdsData = (tranzilaResponse as any)?.['3ds_data']
    const redirectUrl =
      tdsData?.challengeUrl ||
      (tranzilaResponse as any).redirect_url ||
      (tranzilaResponse as any).three_d_secure_url ||
      (tranzilaResponse as any).acs_url ||
      (tranzilaResponse as any).payment_url

    // ── Subcase: 3DS challenge required ──────────────────────────
    if (redirectUrl) {
      const trackId =
        tdsData?.track_id ||
        tranzilaResponse.transaction_id ||
        tranzilaResponse.index ||
        null

      console.log(`[CHARGE][${logId}] 3DS challenge required → trackId: ${trackId}`)

      await supabase
        .from('payment_sessions')
        .update({
          status: 'pending_3ds',
          tranzila_transaction_id: trackId,
          raw_response: {
            ...(tranzilaResponse as any),
            _gift_card: giftCardInfo
              ? { id: giftCardInfo.id, code: giftCardInfo.code, appliedAmount: giftCardInfo.appliedAmount }
              : null,
          },
        })
        .eq('id', sessionId)

      return NextResponse.json({
        success: false,
        requires3DS: true,
        redirectUrl,
        sessionId,
        trackId,
        paymentMethod: 'card',
      })
    }

    // ── Subcase: Direct result (no 3DS challenge) ─────────────────
    const isSuccess = TranzilaClient.isSuccess(tranzilaResponse)
    const errorMsg = TranzilaClient.getErrorMessage(tranzilaResponse)

    console.log(`[CHARGE][${logId}] Direct result → isSuccess: ${isSuccess}`)

    if (!isSuccess) {
      console.warn(`[CHARGE][${logId}] Transaction declined: ${errorMsg}`)
      await supabase
        .from('payment_sessions')
        .update({
          status: 'failed',
          raw_response: tranzilaResponse as any,
          error_message: errorMsg,
        })
        .eq('id', sessionId)

      return NextResponse.json({ success: false, error: errorMsg })
    }

    // ── Direct approval: create order and notify ──────────────────
    const txnId = String(tranzilaResponse.ConfirmationCode || tranzilaResponse.index || `TRX-${Date.now()}`)

    const postPayment = await handlePostPayment({
      logId, session, sessionId, customerInfo,
      giftCardCode, giftCardAmount: validGiftCardAmount,
      transactionId: txnId,
    })

    let shopifyOrderId = session.order_id
    let shopifyOrderUrl: string | undefined

    try {
      const orderResult = await createOrderAndNotify({
        logId, session, customerInfo, transactionId: txnId, giftCardInfo,
      })
      shopifyOrderId = orderResult.shopifyOrderId
      shopifyOrderUrl = orderResult.shopifyOrderUrl
    } catch (err) {
      console.error(`[CHARGE][${logId}] Shopify order creation failed:`, err)
    }

    await supabase
      .from('payment_sessions')
      .update({
        status: 'paid',
        raw_response: {
          ...(tranzilaResponse as any),
          _gift_card: giftCardInfo
            ? { code: giftCardInfo.code, appliedAmount: giftCardInfo.appliedAmount, remainingBalance: postPayment.giftCardRemainingBalance }
            : null,
          _generated_gift_cards: postPayment.generatedCards.map(c => ({
            code: c.code, amount: c.original_amount, currency: c.currency,
          })),
        },
        order_id: shopifyOrderId,
        tranzila_transaction_id: tranzilaResponse.transaction_id || tranzilaResponse.ConfirmationCode || tranzilaResponse.index || null,
        error_message: null,
      })
      .eq('id', sessionId)

    console.log(`[CHARGE][${logId}] Payment completed successfully`)

    return NextResponse.json({
      success: true,
      confirmationCode: txnId,
      message: 'Payment processed successfully',
      giftCardAmount: validGiftCardAmount > 0 ? validGiftCardAmount : undefined,
      giftCardRemainingBalance: postPayment.giftCardRemainingBalance,
      generatedGiftCards: postPayment.generatedCards.map(c => ({
        code: c.code, amount: c.original_amount, currency: c.currency,
      })),
      shopifyOrderUrl,
    })

  } catch (error: any) {
    console.error(`[CHARGE] CRITICAL ERROR:`, error)
    return NextResponse.json(
      { error: 'Payment processing failed', detail: error.message },
      { status: 500 }
    )
  }
}