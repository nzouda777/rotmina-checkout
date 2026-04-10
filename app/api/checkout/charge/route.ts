import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import type { PaymentSession, CustomerInfo } from '@/lib/types'

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
  return mapping[country] || country // Fallback to original if not found
}

function sanitizePhone(phone: string): string {
  return phone.replace(/\D/g, '') // Remove all non-digits
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
      browserData
    } = body

    console.log(`[CHARGE][${logId}] Received body for session:`, sessionId)

    if (!sessionId || !customerInfo || !cardNumber || !expiryDate || !cvv) {
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

    if (session.status !== 'pending') {
      console.warn(`[CHARGE][${logId}] Session already processed:`, session.status)
      return NextResponse.json(
        { error: 'Payment session already processed' },
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

    const tranzila = createTranzilaClient()
    
    const [month, year] = expiryDate.split('/')
    const expireMonth = parseInt(month, 10)
    const expireYear = parseInt(`20${year}`, 10)
    
    console.log(`[CHARGE][${logId}] Mapping ${session.cart.items?.length || 0} items for Tranzila...`)
    const tranzilaItems = (session.cart.items || []).map((item: any) => ({
      name: String(item.title || 'Product'),
      unit_price: Number(item.price),
      units_number: Number(item.quantity) || 1,
      unit_type: 0,
      type: 'I',
      currency_code: session.cart.currency.toUpperCase()
    }))

    if (tranzilaItems.length === 0) {
      tranzilaItems.push({
        name: String(`Order from ${session.shop}`),
        unit_price: Number(session.cart.total),
        units_number: 1,
        unit_type: 0,
        type: 'I',
        currency_code: session.cart.currency.toUpperCase()
      })
    }

    // ── URL de callback 3DS ──────────────────────────────────────────
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    const callbackUrl = `${baseUrl}/api/checkout/3ds-callback`
    console.log(`[CHARGE][${logId}] 3DS callback URL:`, callbackUrl)
    // ────────────────────────────────────────────────────────────────

    const chargePayload = {
      terminal_name: process.env.TRANZILA_TERMINAL || '',
      txn_currency_code: session.cart.currency.toUpperCase(),
      txn_type: 'debit',
      amount: Number(session.cart.total), // Required field
      expire_month: Number(expireMonth),
      expire_year: Number(expireYear),
      cvv: String(cvv),
      card_number: String(cardNumber.replace(/\s/g, '')),
      payment_plan: 1,
      installments_number: 1,
      card_holder_id: null,
      activate_3ds: "Y",
      "3ds_settings": {
        browser: browserData,
        force_txn_on_3ds_fail: "N",
        force_challenge: 0,
        auth_3ds_redirect: [
          {
            key: 'url',
            value: `${callbackUrl}?merchant_data=${sessionId}`
          }
        ]
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

    console.log(`[CHARGE][${logId}] Calling Tranzila API...`)
    const tranzilaResponse = await tranzila.charge(chargePayload)
    console.log(`[CHARGE][${logId}] Tranzila raw response:`, JSON.stringify(tranzilaResponse))

    // ── Cas 1 : Tranzila demande une redirection 3DS ─────────────────
    const redirectUrl =
      tranzilaResponse.redirect_url ||
      tranzilaResponse.three_d_secure_url ||
      tranzilaResponse.acs_url ||
      tranzilaResponse.payment_url

    if (redirectUrl) {
      console.log(`[CHARGE][${logId}] 3DS required → redirect:`, redirectUrl)

      await supabase
        .from('payment_sessions')
        .update({
          status: 'pending_3ds',
          tranzila_transaction_id: tranzilaResponse.transaction_id || tranzilaResponse.index || null,
          raw_response: tranzilaResponse as any,
        })
        .eq('id', sessionId)

      return NextResponse.json({
        success: false,
        requires3DS: true,
        redirectUrl,
        sessionId,
      })
    }
    // ─────────────────────────────────────────────────────────────────

    // ── Cas 2 : Approuvé directement (terminal 3DS désactivé) ────────
    const isSuccess = TranzilaClient.isSuccess(tranzilaResponse)
    console.log(`[CHARGE][${logId}] Direct result — success:`, isSuccess, '| Response:', tranzilaResponse.Response)

    let shopifyOrderId = session.order_id

    if (isSuccess && !shopifyOrderId) {
      try {
        console.log(`[CHARGE][${logId}] Creating Shopify order...`)
        const order = await createShopifyOrder({
          session: session as PaymentSession,
          customer: customerInfo,
          transactionId: tranzilaResponse.ConfirmationCode || tranzilaResponse.index,
        })
        shopifyOrderId = String(order.id)
        console.log(`[CHARGE][${logId}] Shopify order created:`, shopifyOrderId)
      } catch (err) {
        console.error(`[CHARGE][${logId}] Failed to create Shopify order:`, err)
      }
    }

    await supabase
      .from('payment_sessions')
      .update({
        status: isSuccess ? 'paid' : 'failed',
        raw_response: tranzilaResponse as any,
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
      })
    } else {
      return NextResponse.json({
        success: false,
        error: TranzilaClient.getErrorMessage(tranzilaResponse),
      })
    }
    // ─────────────────────────────────────────────────────────────────

  } catch (error: any) {
    console.error(`[CHARGE][${logId}] CRITICAL ERROR:`, error)
    return NextResponse.json(
      { error: 'Payment processing failed', detail: error.message },
      { status: 500 }
    )
  }
}