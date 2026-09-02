import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import { debitGiftCard, generateGiftCardsForOrder, validateGiftCard } from '@/lib/gift-cards'
import { debitCoupon } from '@/lib/coupons'
import { sendOrderConfirmationEmail, sendAdminOrderNotification } from '@/lib/email'
import { sendMorningReceiptLogged, detectPaymentMethod } from '@/lib/morning'
import { isPayableCurrency, tranzilaCurrencyCode, tranzilaChargeCurrency, getExchangeRate, withCurrencyParam } from '@/lib/currency'
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
    'Switzerland': 'CH',
    'Europe': 'EU',
  }
  return mapping[country] || country
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
  couponCode?: string
  transactionId?: string
  shopifyOrderId?: string
}): Promise<PostPaymentResult> {
  const { logId, session, sessionId, customerInfo, giftCardCode, giftCardAmount, transactionId, shopifyOrderId } = params
  const results: PostPaymentResult = { debitSuccess: true, generatedCards: [] }

  // 1. Debit gift card if used as payment
  if (giftCardCode && giftCardAmount && giftCardAmount > 0) {
    try {
      console.log(`[CHARGE][${logId}] Debiting gift card ${giftCardCode} for ${giftCardAmount} ${session.cart?.currency}...`)
      const updatedCard = await debitGiftCard({
        code: giftCardCode,
        amount: giftCardAmount,
        amountCurrency: session.cart?.currency,
        sessionId,
      })
      results.giftCardRemainingBalance = updatedCard.balance ?? undefined
      console.log(`[CHARGE][${logId}] Gift card debited successfully`)
    } catch (gcError) {
      console.error(`[CHARGE][${logId}] WARNING: Payment succeeded but gift card debit failed:`, gcError)
      results.debitSuccess = false
    }
  }

  // 1b. Debit coupon code usage
  const couponCode = (params as any).couponCode
  if (couponCode) {
    try {
      console.log(`[CHARGE][${logId}] Debiting coupon ${couponCode}...`)
      await debitCoupon(couponCode)
      console.log(`[CHARGE][${logId}] Coupon debited successfully`)
    } catch (cpError) {
      console.error(`[CHARGE][${logId}] WARNING: Payment succeeded but coupon debit failed:`, cpError)
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
  const shopifyOrderUrl = withCurrencyParam(
    order.order_status_url || `https://${shopifyDomain}/pages/success?order_id=${shopifyOrderId}`,
    session.cart?.currency
  )
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

  // Send Morning Receipt (non-blocking)
  try {
    console.log(`[CHARGE][${logId}] Sending Morning receipt...`)
    await sendMorningReceiptLogged(`[CHARGE][${logId}]`, {
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
  } catch (morningErr) {
    console.error(`[CHARGE][${logId}] Failed to send Morning receipt:`, morningErr)
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
      couponCode,
      couponAmount = 0,
      shippingFeeAmount = 0,
      israeliId,
      lang: bodyLang,
    } = body

    console.log(`[CHARGE][${logId}] Session: ${sessionId} | Method: ${paymentMethod}`)
    console.log(`[CHARGE][${logId}] Gift card: Code=${giftCardCode || 'none'}, Amount=${giftCardAmount}`)
    console.log(`[CHARGE][${logId}] Israeli ID: ${israeliId || 'none'}`)

    if (!sessionId || !customerInfo) {
      return NextResponse.json({ error: 'Missing required payment information' }, { status: 400 })
    }

    // Add Israeli ID to customerInfo if provided
    if (israeliId) {
      customerInfo.nationalId = israeliId
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

    // Language the receipt/confirmation email should be sent in: the client
    // (current checkout UI language) is the freshest source; fall back to
    // whatever was last synced onto the session, then to Hebrew.
    const receiptLang: 'he' | 'en' =
      bodyLang === 'en' || bodyLang === 'he'
        ? bodyLang
        : (session.cart?.language === 'en' ? 'en' : 'he')

    // Hard guard: only currencies Tranzila can actually charge (see
    // lib/currency.ts PAYABLE_CURRENCIES) may reach the charge step — this used
    // to fall through to the ILS code and debit the wrong currency (bug #2:
    // 300 EUR → 300 ILS). Legitimate currency switches go through the session
    // PATCH before payment, so this only triggers for stale/tampered sessions.
    const cartCurrency = ((session.cart?.currency as string) || 'ILS').toUpperCase()
    if (!isPayableCurrency(cartCurrency)) {
      console.error(`[CHARGE][${logId}] Session currency ${cartCurrency} is not chargeable — blocking`)
      return NextResponse.json(
        { error: 'This currency is not supported for payment. Please refresh the page — prices will be shown in USD.' },
        { status: 400 }
      )
    }

    if (session.status === 'paid' || session.status === 'processing') {
      return NextResponse.json(
        { error: 'Payment session already processed or is currently processing' },
        { status: 400 }
      )
    }

    // Lock session to prevent duplicate charges + save customer info.
    // If the status constraint rejects 'processing' (migration 003 not yet applied),
    // fall back to saving the customer field alone so callbacks can still create the Shopify order.
    const { error: lockErr } = await supabase
      .from('payment_sessions')
      .update({ status: 'processing', error_message: null, customer: customerInfo as CustomerInfo })
      .eq('id', sessionId)

    if (lockErr) {
      console.warn(`[CHARGE][${logId}] Combined lock+customer update failed (run migration 003): ${lockErr.message}`)
      // Save customer separately so the payment callback can still create the Shopify order.
      const { error: customerErr } = await supabase
        .from('payment_sessions')
        .update({ customer: customerInfo as CustomerInfo, error_message: null })
        .eq('id', sessionId)
      if (customerErr) {
        console.error(`[CHARGE][${logId}] ❌ Customer save failed too: ${customerErr.message}`)
        return NextResponse.json({ error: 'Failed to save payment session' }, { status: 500 })
      }
      console.log(`[CHARGE][${logId}] Customer saved via fallback (status not changed to processing)`)
    }

    const orderTotal = Number(session.cart.total) + (Number(shippingFeeAmount) || 0)
    const validCouponAmount = Math.min(Number(couponAmount) || 0, orderTotal)
    const priceAfterCoupon = Math.max(orderTotal - validCouponAmount, 0)
    let validGiftCardAmount = Math.min(Number(giftCardAmount) || 0, priceAfterCoupon)

    // Server-side gift card verification: never trust the client-sent amount.
    // The card balance lives in the card's own currency (usually ILS) — convert
    // it to the cart currency before clamping, so a 300 ILS card can only ever
    // reduce ~80 USD on a USD checkout, not 300 USD.
    if (giftCardCode && validGiftCardAmount > 0) {
      const card = await validateGiftCard(giftCardCode)
      if (!card || card.status === 'disabled') {
        await supabase.from('payment_sessions').update({ status: 'pending' }).eq('id', sessionId)
        return NextResponse.json({ error: 'Gift card is not valid' }, { status: 400 })
      }
      if (card.discount_type === 'percentage') {
        if (card.status !== 'active') {
          await supabase.from('payment_sessions').update({ status: 'pending' }).eq('id', sessionId)
          return NextResponse.json({ error: 'Gift card has already been used' }, { status: 400 })
        }
        const maxPercentAmount = Math.round(orderTotal * ((Number(card.discount_value) || 0) / 100) * 100) / 100
        validGiftCardAmount = Math.min(validGiftCardAmount, maxPercentAmount)
      } else {
        if (card.status !== 'active' || (Number(card.balance) || 0) <= 0) {
          await supabase.from('payment_sessions').update({ status: 'pending' }).eq('id', sessionId)
          return NextResponse.json({ error: 'Gift card has no remaining balance' }, { status: 400 })
        }
        let balanceInCartCurrency = Number(card.balance) || 0
        const cardCur = (card.currency || 'ILS').toUpperCase()
        if (cardCur !== cartCurrency) {
          const gcRate = await getExchangeRate(cardCur, cartCurrency)
          balanceInCartCurrency = Math.round(balanceInCartCurrency * gcRate * 100) / 100
          console.log(`[CHARGE][${logId}] GC balance converted: ${card.balance} ${cardCur} → ${balanceInCartCurrency} ${cartCurrency} (rate: ${gcRate})`)
        }
        validGiftCardAmount = Math.min(validGiftCardAmount, balanceInCartCurrency)
      }
      if (validGiftCardAmount < Number(giftCardAmount)) {
        console.warn(`[CHARGE][${logId}] Client GC amount ${giftCardAmount} clamped to ${validGiftCardAmount} ${cartCurrency}`)
      }
    }
    const rawChargeAmount = Math.max(priceAfterCoupon - validGiftCardAmount, 0)
    const chargeAmount = Math.round(rawChargeAmount * 100) / 100

    console.log(`[CHARGE][${logId}] Total: ${orderTotal} | Coupon: ${validCouponAmount} | GC: ${validGiftCardAmount} | CC charge: ${chargeAmount}`)

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
    const isTestCard = cardNumber?.replace(/\s/g, '') === '5430050220380520'

    // ── Case A: Gift card covers entire amount OR test card ───────
    if (chargeAmount <= 0 || isTestCard) {
      const txnId = isTestCard ? `TEST-${Date.now()}` : `GC-${giftCardCode}`
      console.log(`[CHARGE][${logId}] ${isTestCard ? 'Test card' : 'GC covers full order'} → txnId: ${txnId}`)

      const postPayment = await handlePostPayment({
        logId, session, sessionId, customerInfo,
        giftCardCode, giftCardAmount: validGiftCardAmount,
        couponCode: couponCode || undefined,
        transactionId: txnId,
      } as any)

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

      // Re-read the session so session.customer is populated (saved by the lock update above)
      const { data: freshSession } = await supabase
        .from('payment_sessions')
        .select('*')
        .eq('id', sessionId)
        .single()

      const sessionForOrder = freshSession || session
      const customerForOrder = (sessionForOrder.customer as CustomerInfo) || customerInfo

      try {
        console.log(`[CHARGE][${logId}] Creating Shopify order (test card / GC-only)...`)
        const order = await createShopifyOrder({
          session: sessionForOrder as PaymentSession,
          customer: customerForOrder,
          transactionId: txnId,
          giftCard: giftCardInfo,
        })
        shopifyOrderId = String(order.id)
        const shopifyDomain = sessionForOrder.shop || 'rotmina.myshopify.com'
        shopifyOrderUrl = withCurrencyParam(
          order.order_status_url || `https://${shopifyDomain}/pages/success?order_id=${shopifyOrderId}`,
          sessionForOrder.cart?.currency
        )
        console.log(`[CHARGE][${logId}] ✅ Shopify order created: ${shopifyOrderId}`)

        // Save order_id immediately
        await supabase
          .from('payment_sessions')
          .update({ order_id: shopifyOrderId })
          .eq('id', sessionId)

        // Confirmation email (non-blocking)
        sendOrderConfirmationEmail({
          toEmail: customerForOrder.email,
          orderName: String(order.name || order.id),
          customerName: `${customerForOrder.firstName} ${customerForOrder.lastName}`,
          items: (sessionForOrder.cart?.items || []).map((item: any) => ({
            title: item.title,
            quantity: item.quantity,
            price: item.price,
            image: item.image,
          })),
          subtotal: sessionForOrder.cart?.subtotal,
          shipping: sessionForOrder.cart?.shipping,
          tax: sessionForOrder.cart?.tax,
          total: sessionForOrder.cart?.total,
          currency: sessionForOrder.cart?.currency,
          shippingAddress: {
            address: customerForOrder.address,
            city: customerForOrder.city,
            postalCode: customerForOrder.postalCode,
            country: customerForOrder.country,
          },
          orderStatusUrl: shopifyOrderUrl,
          lang: receiptLang,
        }).catch((emailErr: any) =>
          console.error(`[CHARGE][${logId}] Confirmation email failed (non-fatal):`, emailErr)
        )

        // Admin notification (non-blocking)
        sendAdminOrderNotification({
          orderName: String(order.name || order.id),
          customerName: `${customerForOrder.firstName} ${customerForOrder.lastName}`,
          customerEmail: customerForOrder.email,
          customerPhone: (customerForOrder as any).phone,
          items: (sessionForOrder.cart?.items || []).map((item: any) => ({
            title: item.title,
            quantity: item.quantity,
            price: item.price,
          })),
          subtotal: sessionForOrder.cart?.subtotal,
          shipping: sessionForOrder.cart?.shipping,
          tax: sessionForOrder.cart?.tax,
          total: sessionForOrder.cart?.total,
          currency: sessionForOrder.cart?.currency,
          shippingAddress: {
            address: customerForOrder.address,
            city: customerForOrder.city,
            postalCode: customerForOrder.postalCode,
            country: customerForOrder.country,
          },
          paymentMethod: isTestCard ? 'test_card' : 'gift_card',
          orderStatusUrl: shopifyOrderUrl,
        }).catch((adminErr: any) =>
          console.error(`[CHARGE][${logId}] Admin notification failed (non-fatal):`, adminErr)
        )

        // Morning receipt (non-blocking)
        sendMorningReceiptLogged(`[CHARGE][${logId}]`, {
          customerEmail: customerForOrder.email,
          customerName: `${customerForOrder.firstName} ${customerForOrder.lastName}`,
          amount: Number(sessionForOrder.cart?.total || 0),
          currency: sessionForOrder.cart?.currency,
          paymentMethod: isTestCard ? 'test_card' : 'gift_card',
          items: (sessionForOrder.cart?.items || []).map((item: any) => ({
            description: item.title,
            quantity: item.quantity,
            price: Number(item.price),
          })),
          lang: receiptLang,
        })
      } catch (err: any) {
        console.error(`[CHARGE][${logId}] ❌ Shopify order creation failed:`, err?.message || err)
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
            shopifyOrderUrl: shopifyOrderUrl || undefined,
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
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get('host')}`
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

    // ── Case B1: Bit payment — Hosted Fields first, REST API fallback ──────────
    if (paymentMethod === 'bit') {
      // Bit only supports ILS. A USD cart paid via Bit would debit the USD
      // amount in ILS — same class of bug as #2, so block it server-side.
      if (cartCurrency !== 'ILS') {
        console.error(`[CHARGE][${logId}] Bit requested for ${cartCurrency} cart — Bit only supports ILS`)
        return NextResponse.json(
          { error: 'Bit payments are only available for orders in ILS. Please pay by credit card.' },
          { status: 400 }
        )
      }
      const bitCallbackBase = `${baseUrl}/api/checkout/bit-callback`
      const currencyCode = tranzilaCurrencyCode(cartCurrency)
      const terminal = process.env.TRANZILA_TERMINAL || ''

      // Generate thtk. If available, use Hosted Fields (chargeBit via SDK).
      // If not available (password not configured), fall back to REST API redirect.
      const thtk = await tranzila.getHandshakeToken(chargeAmount, currencyCode)
      console.log(`[CHARGE][${logId}] Bit | terminal=${terminal} | amount=${chargeAmount} | thtk=${thtk ? 'present' : 'null → REST API fallback'}`)

      if (thtk) {
        // ── Hosted Fields path: SDK chargeBit() ────────────────────────
        await supabase
          .from('payment_sessions')
          .update({
            status: 'pending_bit',
            raw_response: {
              bit_hf_initiated: true,
              _gift_card: giftCardInfo
                ? { id: giftCardInfo.id, code: giftCardInfo.code, appliedAmount: giftCardInfo.appliedAmount }
                : null,
              _coupon: couponCode ? { code: couponCode, appliedAmount: validCouponAmount } : null,
            },
          })
          .eq('id', sessionId)

        // chargeBit() SDK requires ISO currency code ("ILS"), not Tranzila's
        // numeric code ("1") — and the guard above already enforced ILS.
        const currencyIso = 'ILS'

        return NextResponse.json({
          success: false,
          requiresHostedFields: true,
          isBit: true,
          thtk,
          terminal,
          chargeAmount,
          currency: currencyIso,
          callbackSuccessUrl: `${bitCallbackBase}/success?merchant_data=${sessionId}`,
          callbackFailUrl: `${bitCallbackBase}/failure?merchant_data=${sessionId}`,
          callbackNotifyUrl: `${bitCallbackBase}/notify?merchant_data=${sessionId}`,
          sessionId,
          paymentMethod: 'bit',
        })
      }

      // ── REST API fallback: server-side initBit ──────────────────────────────
      try {
        const bitParams = {
          terminal_name: terminal,
          sum: String(chargeAmount),
          currency: currencyCode,
          success_url: `${bitCallbackBase}/success?merchant_data=${sessionId}`,
          fail_url: `${bitCallbackBase}/failure?merchant_data=${sessionId}`,
          notify_url: `${bitCallbackBase}/notify?merchant_data=${sessionId}`,
          merchant_data: sessionId,
        }

        const bitResult = await tranzila.initBit(bitParams)
        console.log(`[CHARGE][${logId}] Bit REST init result:`, JSON.stringify(bitResult))

        const bitUrl =
          bitResult.url ||
          bitResult.redirect_url ||
          bitResult.payment_url ||
          bitResult.bit_url ||
          bitResult.deep_link

        if (!bitUrl) {
          const errMsg =
            String(
              bitResult.error ||
              bitResult.message ||
              (Array.isArray(bitResult.errors) && bitResult.errors[0]?.message) ||
              'Bit payment initialization failed — no redirect URL returned'
            )
          console.error(`[CHARGE][${logId}] Bit REST init no URL. Full result: ${JSON.stringify(bitResult)}`)
          await supabase
            .from('payment_sessions')
            .update({ status: 'failed', error_message: errMsg })
            .eq('id', sessionId)
          return NextResponse.json({ error: errMsg }, { status: 500 })
        }

        await supabase
          .from('payment_sessions')
          .update({
            status: 'pending_bit',
            raw_response: {
              bit_api_initiated: true,
              result: bitResult,
              _gift_card: giftCardInfo
                ? { id: giftCardInfo.id, code: giftCardInfo.code, appliedAmount: giftCardInfo.appliedAmount }
                : null,
              _coupon: couponCode ? { code: couponCode, appliedAmount: validCouponAmount } : null,
            },
          })
          .eq('id', sessionId)

        return NextResponse.json({
          success: false,
          requiresHostedFields: false,
          redirectUrl: bitUrl,
          paymentMethod: 'bit',
          sessionId,
        })
      } catch (bitErr: any) {
        console.error(`[CHARGE][${logId}] Bit REST init failed:`, bitErr.message)
        await supabase
          .from('payment_sessions')
          .update({ status: 'failed', error_message: bitErr.message })
          .eq('id', sessionId)
        return NextResponse.json({ error: 'Bit payment initialization failed', detail: bitErr.message }, { status: 500 })
      }
    }

    // ── Case B2: Credit card (Tranzila Hosted Fields SAQ A) ──────────────────
    if (paymentMethod === 'card') {
      console.log(`[CHARGE][${logId}] Initiating Hosted Fields for card payment`)
      const callbackUrl = `${baseUrl}/api/checkout/callback`

      // Real ISO currency code — Tranzila's v1 API charges directly in the
      // customer's selected currency (ILS/USD/EUR/GBP/CAD/CHF/AUD), not just ILS/USD.
      const currencyCode = tranzilaChargeCurrency(cartCurrency)
      console.log(`[CHARGE][${logId}] Currency: ${cartCurrency} → Tranzila charge currency: ${currencyCode}`)

      // Always generate a FRESH thtk server-side for each charge attempt.
      // Tranzila confirmed this is the correct approach — the SDK create() is
      // called without a thtk, and each charge() gets its own fresh token.
      const thtk = await tranzila.getHandshakeToken(chargeAmount, currencyCode)
      console.log(`[CHARGE][${logId}] Fresh thtk generated: ${thtk ? String(thtk).substring(0, 10) + '…' : 'NULL'} | amount: ${chargeAmount} | currency: ${currencyCode}`)

      const terminal = process.env.TRANZILA_TERMINAL || ''
      console.log(`[CHARGE][${logId}] Terminal: ${terminal || 'MISSING!'} | callbackUrl: ${callbackUrl}`)
      console.log(`[CHARGE][${logId}] chargeAmount: ${chargeAmount} | installments: ${installments}`)

      if (!terminal) {
        console.error(`[CHARGE][${logId}] CRITICAL: TRANZILA_TERMINAL env var is not set!`)
      }

      if (!thtk) {
        console.error(`[CHARGE][${logId}] thtk is null — TRANZILA_TERMINAL_PASSWORD is missing or incorrect.`)
        await supabase.from('payment_sessions').update({ status: 'pending' }).eq('id', sessionId)
        return NextResponse.json(
          { error: 'Card payment is temporarily unavailable. Please try Bit payment or contact support.' },
          { status: 503 }
        )
      }

      await supabase
        .from('payment_sessions')
        .update({
          status: 'pending_3ds',
          raw_response: {
            hosted_fields_initiated: true,
            _gift_card: giftCardInfo
              ? { id: giftCardInfo.id, code: giftCardInfo.code, appliedAmount: giftCardInfo.appliedAmount }
              : null,
            _coupon: couponCode ? { code: couponCode, appliedAmount: validCouponAmount } : null,
          },
        })
        .eq('id', sessionId)

      const responsePayload = {
        success: false,
        requiresHostedFields: true,
        thtk,
        terminal,
        chargeAmount,
        currency: currencyCode,
        callbackUrl,
        sessionId,
        paymentMethod: 'card',
      }
      console.log(`[CHARGE][${logId}] Returning requiresHostedFields response (thtk present: ${!!thtk})`)
      return NextResponse.json(responsePayload)
    }

  } catch (error: any) {
    console.error(`[CHARGE] CRITICAL ERROR:`, error)
    return NextResponse.json(
      { error: 'Payment processing failed', detail: error.message },
      { status: 500 }
    )
  }
}