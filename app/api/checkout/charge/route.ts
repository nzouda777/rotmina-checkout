import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import { debitGiftCard, generateGiftCardsForOrder } from '@/lib/gift-cards'
import type { PaymentSession, CustomerInfo, GiftCardInfo } from '@/lib/types'

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

/**
 * Handle post-payment tasks: debit gift card + generate new gift card codes
 */
async function handlePostPayment(params: {
  logId: string
  session: any
  sessionId: string
  customerInfo: CustomerInfo
  giftCardCode?: string
  giftCardAmount?: number
  transactionId?: string
  shopifyOrderId?: string
}) {
  const { logId, session, sessionId, customerInfo, giftCardCode, giftCardAmount, transactionId, shopifyOrderId } = params
  const results: { debitSuccess: boolean; generatedCards: any[]; giftCardRemainingBalance?: number } = { debitSuccess: true, generatedCards: [] }

  // 1. Debit gift card if used as payment
  if (giftCardCode && giftCardAmount && giftCardAmount > 0) {
    try {
      console.log(`[CHARGE][${logId}] Debiting gift card ${giftCardCode} for ${giftCardAmount}...`)
      const updatedCard = await debitGiftCard({
        code: giftCardCode,
        amount: giftCardAmount,
        sessionId,
      })
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
    console.error(`[CHARGE][${logId}] Failed to generate gift cards:`, err)
  }

  return results
}

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
      // Gift card fields (redemption)
      giftCardId,
      giftCardCode,
      giftCardAmount = 0,
    } = body

    console.log(`[CHARGE][${logId}] Received body for session:`, sessionId)
    console.log(`[CHARGE][${logId}] Gift card: Code=${giftCardCode || 'none'}, Amount=${giftCardAmount}`)

    if (!sessionId || !customerInfo) {
      console.warn(`[CHARGE][${logId}] Missing required fields`)
      return NextResponse.json(
        { error: 'Missing required payment information' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    console.log(`[CHARGE][${logId}] Fetching session from database...`)
    const { data: session, error: sessionError } = await supabase
      .from('payment_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      console.error(`[CHARGE][${logId}] Session not found or error:`, sessionError)
      return NextResponse.json(
        { error: 'Payment session not found' },
        { status: 404 }
      )
    }

    console.log(`[CHARGE][${logId}] Session found. Current status:`, session.status)

    if (session.status === 'paid' || session.status === 'processing') {
      console.warn(`[CHARGE][${logId}] Session already processed or processing:`, session.status)
      return NextResponse.json(
        { error: 'Payment session already processed or is currently processing' },
        { status: 400 }
      )
    }

    console.log(`[CHARGE][${logId}] Updating session status to 'processing'...`)
    await supabase
      .from('payment_sessions')
      .update({ 
        status: 'processing',
        customer: customerInfo as CustomerInfo,
      })
      .eq('id', sessionId)

    const orderTotal = Number(session.cart.total)
    const validGiftCardAmount = Math.min(Number(giftCardAmount) || 0, orderTotal)
    const chargeAmount = Math.max(orderTotal - validGiftCardAmount, 0)

    console.log(`[CHARGE][${logId}] Order total: ${orderTotal}, Gift card: ${validGiftCardAmount}, CC charge: ${chargeAmount}`)

    // Prepare gift card info for order creation
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

    // ── Case: Gift card covers entire order ─────────────────────────────
    if (chargeAmount <= 0) {
      console.log(`[CHARGE][${logId}] Gift card covers full order. No CC charge needed.`)

      // Handle post-payment tasks
      const postPayment = await handlePostPayment({
        logId, session, sessionId, customerInfo,
        giftCardCode, giftCardAmount: validGiftCardAmount,
        transactionId: `GC-${giftCardCode}`,
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
        console.log(`[CHARGE][${logId}] Creating Shopify order (gift card only)...`)
        const order = await createShopifyOrder({
          session: session as PaymentSession,
          customer: customerInfo,
          transactionId: `GC-${giftCardCode}`,
          giftCard: giftCardInfo,
        })
        shopifyOrderId = String(order.id)
        shopifyOrderUrl = order.order_status_url || `https://${session.shop}/orders/${order.id}`
        console.log(`[CHARGE][${logId}] Shopify order created:`, shopifyOrderId)
      } catch (err) {
        console.error(`[CHARGE][${logId}] Failed to create Shopify order:`, err)
      }

      await supabase
        .from('payment_sessions')
        .update({
          status: 'paid',
          order_id: shopifyOrderId,
          raw_response: {
            payment_method: 'gift_card_only',
            gift_card_code: giftCardCode,
            gift_card_amount: validGiftCardAmount,
            gift_card_remaining_balance: postPayment.giftCardRemainingBalance,
            generated_gift_cards: postPayment.generatedCards.map(c => ({
              code: c.code,
              amount: c.original_amount,
              currency: c.currency,
            })),
          } as any,
        })
        .eq('id', sessionId)

      return NextResponse.json({
        success: true,
        confirmationCode: `GC-${giftCardCode}`,
        giftCardAmount: validGiftCardAmount,
        giftCardRemainingBalance: postPayment.giftCardRemainingBalance,
        generatedGiftCards: postPayment.generatedCards.map(c => ({
          code: c.code,
          amount: c.original_amount,
          currency: c.currency,
        })),
        shopifyOrderUrl,
      })
    }

    // ── Case: Credit card charge (with or without gift card) ────────────
    if (!cardNumber || !expiryDate || !cvv) {
      console.warn(`[CHARGE][${logId}] Missing credit card fields for CC charge`)
      await supabase.from('payment_sessions').update({ status: 'pending' }).eq('id', sessionId)
      return NextResponse.json(
        { error: 'Missing required credit card information' },
        { status: 400 }
      )
    }

    const tranzila = createTranzilaClient()
    
    const [month, year] = expiryDate.split('/')
    const expireMonth = parseInt(month, 10)
    const expireYear = parseInt(`20${year}`, 10)
    
    console.log(`[CHARGE][${logId}] Mapping ${session.cart.items?.length || 0} items for Tranzila...`)
    const tranzilaItems = (session.cart.items || []).map((item: any) => ({
      name: String(item.title || 'Product'),
      unit_price: Number(item.price),
      units_number: Number(item.quantity) || 1,
      unit_type: 1,
      type: 'I',
      currency_code: session.cart.currency.toUpperCase()
    }))

    if (tranzilaItems.length === 0) {
      tranzilaItems.push({
        name: String(`Order from ${session.shop}`),
        unit_price: Number(chargeAmount),
        units_number: 1,
        unit_type: 1,
        type: 'I',
        currency_code: session.cart.currency.toUpperCase()
      })
    }

    // Add gift card discount line if applicable
    if (validGiftCardAmount > 0) {
      tranzilaItems.push({
        name: `Gift Card ${giftCardCode}`,
        unit_price: -Number(validGiftCardAmount),
        units_number: 1,
        unit_type: 1,
        type: 'I',
        currency_code: session.cart.currency.toUpperCase()
      })
    }

    // ── 3DS callback URL ──────────────────────────────────────────
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    const callbackUrl = `${baseUrl}/api/checkout/3ds-callback`
    console.log(`[CHARGE][${logId}] 3DS callback URL:`, callbackUrl)

    // Extract client IP for 3DS browser data
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip') 
      || '127.0.0.1'

    const enrichedBrowserData = {
      ...browserData,
      ip: clientIp,
    }
    
    // ── Installment calculation (based on CC charge amount) ──────
    let payment_plan = 1
    let tranzilaInstallments = {}

    if (installments > 1 && chargeAmount > 0) {
      payment_plan = 8
      const otherAmount = Math.floor((chargeAmount / installments) * 100) / 100
      const firstAmount = chargeAmount - (otherAmount * (installments - 1))
      tranzilaInstallments = {
        installments_number: installments,
        first_installment_amount: Number(firstAmount.toFixed(2)),
        other_installments_amount: Number(otherAmount.toFixed(2))
      }
      console.log(`[CHARGE][${logId}] Installments: ${installments}x, First: ${firstAmount.toFixed(2)}, Others: ${otherAmount.toFixed(2)}`)
    }

    const chargePayload = {
      terminal_name: process.env.TRANZILA_TERMINAL || '',
      txn_currency_code: session.cart.currency.toUpperCase(),
      txn_type: 'debit',
      expire_month: Number(expireMonth),
      expire_year: Number(expireYear),
      cvv: String(cvv),
      card_number: String(cardNumber.replace(/\s/g, '')),
      payment_plan: payment_plan,
      ...tranzilaInstallments,
      activate_3ds: "Y",
      "3ds_settings": {
        browser: enrichedBrowserData,
        force_txn_on_3ds_fail: "Y",
        force_challenge: 0,
        auth_3ds_redirect: {
          url: `${callbackUrl}?merchant_data=${sessionId}`
        }
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
      items: tranzilaItems,
    }

    console.log(`[CHARGE][${logId}] === FULL PAYLOAD ===`)
    console.log(JSON.stringify(chargePayload, null, 2))
    console.log(`[CHARGE][${logId}] === END PAYLOAD ===`)

    console.log(`[CHARGE][${logId}] Calling Tranzila API (charging ${chargeAmount})...`)
    const tranzilaResponse = await tranzila.charge(chargePayload)
    console.log(`[CHARGE][${logId}] Tranzila raw response fields:`, Object.keys(tranzilaResponse))
    
    // ── Case 1: 3DS redirect required ─────────────────────────────
    const tdsData = (tranzilaResponse as any)?.['3ds_data']
    const redirectUrl =
      tdsData?.challengeUrl ||
      (tranzilaResponse as any).redirect_url ||
      (tranzilaResponse as any).three_d_secure_url ||
      (tranzilaResponse as any).acs_url ||
      (tranzilaResponse as any).payment_url

    console.log(`[CHARGE][${logId}] Detected redirectUrl:`, redirectUrl ? `YES (${redirectUrl.substring(0, 30)}...)` : 'NO')

    if (redirectUrl) {
      console.log(`[CHARGE][${logId}] 3DS required → returning redirect logic`) 
      const trackId = tdsData?.track_id || null

      // Store gift card info in session for post-3DS processing
      await supabase
        .from('payment_sessions')
        .update({
          status: 'pending_3ds',
          tranzila_transaction_id: trackId || tranzilaResponse.transaction_id || tranzilaResponse.index || null,
          raw_response: {
            ...tranzilaResponse as any,
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
        requires3DS: true,
        redirectUrl,
        sessionId,
        trackId: trackId || tranzilaResponse.transaction_id || tranzilaResponse.index || null,
      })
    }

    // ── Case 2: Direct approval ─────────────────────────────────
    const isSuccess = TranzilaClient.isSuccess(tranzilaResponse)
    console.log(`[CHARGE][${logId}] Direct result — success:`, isSuccess, '| Response:', tranzilaResponse.Response)

    let shopifyOrderId = session.order_id
    let postPayment: { debitSuccess: boolean; generatedCards: any[]; giftCardRemainingBalance?: number } = { debitSuccess: true, generatedCards: [] }
    let shopifyOrderUrl = process.env.SHOPIFY_STORE_DOMAIN

    if (isSuccess) {
      const txnId = tranzilaResponse.ConfirmationCode || tranzilaResponse.index

      // Handle gift card debit + code generation
      postPayment = await handlePostPayment({
        logId, session, sessionId, customerInfo,
        giftCardCode, giftCardAmount: validGiftCardAmount,
        transactionId: txnId,
        shopifyOrderId,
      })

      if (!shopifyOrderId) {
        try {
          console.log(`[CHARGE][${logId}] Creating Shopify order...`)
          const order = await createShopifyOrder({
            session: session as PaymentSession,
            customer: customerInfo,
            transactionId: txnId,
            giftCard: giftCardInfo,
          })
          shopifyOrderId = String(order.id)
          shopifyOrderUrl = order.order_status_url || `https://${session.shop}/orders/${order.id}`
          console.log(`[CHARGE][${logId}] Shopify order created:`, shopifyOrderId)
        } catch (err) {
          console.error(`[CHARGE][${logId}] Failed to create Shopify order:`, err)
        }
      }
    }

    await supabase
      .from('payment_sessions')
      .update({
        status: isSuccess ? 'paid' : 'failed',
        raw_response: {
          ...tranzilaResponse as any,
          _gift_card: giftCardInfo ? {
            code: giftCardInfo.code,
            appliedAmount: giftCardInfo.appliedAmount,
            remainingBalance: postPayment.giftCardRemainingBalance,
          } : null,
          _generated_gift_cards: postPayment.generatedCards.map(c => ({
            code: c.code,
            amount: c.original_amount,
            currency: c.currency,
          })),
        },
        order_id: shopifyOrderId,
        tranzila_transaction_id: tranzilaResponse.ConfirmationCode || tranzilaResponse.index || null,
        error_message: isSuccess ? null : TranzilaClient.getErrorMessage(tranzilaResponse),
      })
      .eq('id', sessionId)

    console.log(`[CHARGE][${logId}] Request completed`)

    if (isSuccess) {
      return NextResponse.json({
        success: true,
        confirmationCode: tranzilaResponse.ConfirmationCode || tranzilaResponse.index,
        message: 'Payment processed successfully',
        giftCardAmount: validGiftCardAmount > 0 ? validGiftCardAmount : undefined,
        giftCardRemainingBalance: postPayment.giftCardRemainingBalance,
        generatedGiftCards: postPayment.generatedCards.map(c => ({
          code: c.code,
          amount: c.original_amount,
          currency: c.currency,
        })),
        shopifyOrderUrl,
      })
    } else {
      return NextResponse.json({
        success: false,
        error: TranzilaClient.getErrorMessage(tranzilaResponse),
      })
    }

  } catch (error: any) {
    console.error(`[CHARGE][${logId}] CRITICAL ERROR:`, error)
    return NextResponse.json(
      { error: 'Payment processing failed', detail: error.message },
      { status: 500 }
    )
  }
}