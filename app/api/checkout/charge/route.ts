import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import { debitGiftCard, generateGiftCardsForOrder } from '@/lib/gift-cards'
import { sendOrderConfirmationEmail } from '@/lib/email'
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
    console.error(`[CHARGE][${logId}] CRITICAL ERROR during gift card generation:`, err)
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
      paymentMethod = 'card',
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
        error_message: null,
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

    const isTestCard = cardNumber?.replace(/\s/g, '') === '5430050220380520';
    const txnId = isTestCard ? `TEST-${Date.now()}` : `GC-${giftCardCode}`;

    // ── Case: Gift card covers entire order OR Test Card ─────────────────────────────
    if (chargeAmount <= 0 || isTestCard) {
      console.log(`[CHARGE][${logId}] ${isTestCard ? 'Test card used' : 'Gift card covers full order'}. No CC charge needed.`)

      // Handle post-payment tasks
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
        console.log(`[CHARGE][${logId}] Creating Shopify order (${isTestCard ? 'test card' : 'gift card only'})...`)
        const order = await createShopifyOrder({
          session: session as PaymentSession,
          customer: customerInfo,
          transactionId: txnId,
          giftCard: giftCardInfo,
        })
        shopifyOrderId = String(order.id)
        const shopifyDomain = session.shop || 'rotmina.myshopify.com'
        shopifyOrderUrl = `https://${shopifyDomain}/pages/success?order_id=${shopifyOrderId}`
        console.log(`[CHARGE][${logId}] Shopify order created:`, shopifyOrderId)

        // ── Send Order Confirmation Email ────────────────────────
        try {
          console.log(`[CHARGE][${logId}] Sending order confirmation email (${isTestCard ? 'test card' : 'GC only'})...`)
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
      } catch (err) {
        console.error(`[CHARGE][${logId}] Failed to create Shopify order:`, err)
      }

      await supabase
        .from('payment_sessions')
        .update({
          status: 'paid',
          order_id: shopifyOrderId,
          tranzila_transaction_id: isTestCard ? txnId : undefined,
          raw_response: {
            payment_method: isTestCard ? 'test_card' : 'gift_card_only',
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
        confirmationCode: txnId,
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
    if (paymentMethod === 'card') {
      if (!cardNumber || !expiryDate || !cvv) {
        console.warn(`[CHARGE][${logId}] Missing credit card fields for CC charge`)
        await supabase.from('payment_sessions').update({ status: 'pending' }).eq('id', sessionId)
        return NextResponse.json(
          { error: 'Missing required credit card information' },
          { status: 400 }
        )
      }
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

    // ── callback URL ──────────────────────────────────────────
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    const callbackUrl = paymentMethod === 'bit' 
      ? `${baseUrl}/api/checkout/bit-callback`
      : `${baseUrl}/api/checkout/3ds-callback`
    console.log(`[CHARGE][${logId}] ${paymentMethod.toUpperCase()} callback URL:`, callbackUrl)

    // Extract client IP for 3DS browser data
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip') 
      || '216.198.79.131'

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

    // ── Base payload for Tranzila ────────────────────────────────
    const basePayload = {
      terminal_name: process.env.TRANZILA_TERMINAL || '',
      txn_currency_code: session.cart.currency.toUpperCase(),
      items: tranzilaItems,
    }

    // ── Case 0: Bit Payment ──────────────────────────────────────
    if (paymentMethod === 'bit') {
      console.log(`[BIT-STEP 1] Starting Bit payload construction for session ${sessionId}`)

      const bitItems = tranzilaItems.map((item: any) => ({
        code: item.code || "",
        name: item.name,
        type: "I",
        units_number: Number(item.units_number),
        unit_type: 1,
        unit_price: Number(item.unit_price),
        price_type: "G",
        currency_code: session.cart.currency.toUpperCase(),
        to_txn_currency_exchange_rate: 1
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
          phone: sanitizePhone(customerInfo.phone)
        },
        items: bitItems,
        response_language: "english",
        created_by_system: "rotmani-checkout"
      }

      console.log(`[BIT-STEP 2] Payload prepared for ${sessionId}:`, JSON.stringify(bitPayload, null, 2))

      console.log(`[BIT-STEP 3] Calling Tranzila Bit Init API...`)
      try {
        const bitResponse = await tranzila.initBit(bitPayload)
        console.log(`[BIT-STEP 4] Bit API Response:`, JSON.stringify(bitResponse, null, 2))
        
        const redirectUrl = bitResponse.bit_url || bitResponse.sale_url
        
        if (redirectUrl) {
          console.log(`[BIT-STEP 5] Bit Init Success. URL generated: ${redirectUrl}`)
          
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
            requires3DS: true, // Reuse the same UI logic for iframe
            redirectUrl: redirectUrl,
            sessionId,
            trackId: null,
          })
        } else {
          console.error(`[BIT-STEP 5] Bit Init Failed: No redirect URL found in response.`)
          throw new Error(bitResponse.message || bitResponse.error || 'Failed to get Bit payment URL')
        }
      } catch (bitErr: any) {
        console.error(`[BIT-STEP 5] EXCEPTION during Bit Init:`, bitErr.message)
        await supabase.from('payment_sessions').update({ status: 'pending' }).eq('id', sessionId)
        return NextResponse.json({ success: false, error: bitErr.message || 'Bit initialization failed' }, { status: 500 })
      }
    }

    const chargePayload = {
      ...basePayload,
      txn_type: 'debit',
      expire_month: Number(expireMonth),
      expire_year: Number(expireYear),
      cvv: String(cvv),
      card_number: String(cardNumber!.replace(/\s/g, '')),
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
    }

    console.log(`[CHARGE][${logId}] === FULL PAYLOAD ===`)
    console.log(JSON.stringify(chargePayload, null, 2))
    console.log(`[CHARGE][${logId}] === END PAYLOAD ===`)

    console.log(`[CHARGE][${logId}] Calling Tranzila API (charging ${chargeAmount})...`)
    const tranzilaResponse = await tranzila.charge(chargePayload)
    console.log(`[CHARGE][${logId}] Tranzila raw response fields:`, Object.keys(tranzilaResponse))
    
    // Check for explicit processor decline BEFORE trusting redirect urls
    const isSuccess = TranzilaClient.isSuccess(tranzilaResponse)
    const errorMsg = TranzilaClient.getErrorMessage(tranzilaResponse)
    
    // If the transaction is not successful (e.g. declined, invalid card, insufficient funds),
    // we MUST fail immediately. We should not attempt 3DS redirect, even if Tranzila
    // echoes back the 3DS URL in the response.
    if (!isSuccess) {
      console.log(`[CHARGE][${logId}] Transaction failed/declined. Skipping 3DS redirect. errorMsg=${errorMsg}`);
      
      await supabase
        .from('payment_sessions')
        .update({
          status: 'failed',
          raw_response: tranzilaResponse as any,
          error_message: errorMsg,
        })
        .eq('id', sessionId)

      return NextResponse.json({
        success: false,
        error: errorMsg,
      })
    }

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

          // ── Send Order Confirmation Email ────────────────────────
          try {
            console.log(`[CHARGE][${logId}] Sending order confirmation email...`)
            await sendOrderConfirmationEmail({
              toEmail: customerInfo.email,
              orderName: String(order.name || order.id), // Use the public order name if available
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
        tranzila_transaction_id: tranzilaResponse.transaction_id || tranzilaResponse.ConfirmationCode || tranzilaResponse.index || null,
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