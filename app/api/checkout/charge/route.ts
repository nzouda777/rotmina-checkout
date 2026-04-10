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
      browserData,
      installments = 1
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
      unit_type: 1,
      type: 'I',
      currency_code: session.cart.currency.toUpperCase()
    }))

    if (tranzilaItems.length === 0) {
      tranzilaItems.push({
        name: String(`Order from ${session.shop}`),
        unit_price: Number(session.cart.total),
        units_number: 1,
        unit_type: 1,
        type: 'I',
        currency_code: session.cart.currency.toUpperCase()
      })
    }

    // ── URL de callback 3DS ──────────────────────────────────────────
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    const callbackUrl = `${baseUrl}/api/checkout/3ds-callback`
    console.log(`[CHARGE][${logId}] 3DS callback URL:`, callbackUrl)
    // ────────────────────────────────────────────────────────────────

    // Extract client IP for 3DS browser data
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip') 
      || '127.0.0.1'

    // Inject IP into browser data
    const enrichedBrowserData = {
      ...browserData,
      ip: clientIp,
    }

    const amount = Number(session.cart.total)
    
    let payment_plan = 1
    let tranzilaInstallments = {}

    if (installments > 1 && amount > 0) {
      payment_plan = 8
      const otherAmount = Math.floor((amount / installments) * 100) / 100
      const firstAmount = amount - (otherAmount * (installments - 1))
      tranzilaInstallments = {
        installments_number: installments,
        first_installment_amount: Number(firstAmount.toFixed(2)),
        other_installments_amount: Number(otherAmount.toFixed(2))
      }
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

    console.log(`[CHARGE][${logId}] === FULL PAYLOAD ===`)
    console.log(JSON.stringify(chargePayload, null, 2))
    console.log(`[CHARGE][${logId}] === END PAYLOAD ===`)

    console.log(`[CHARGE][${logId}] Calling Tranzila API...`)
    const tranzilaResponse = await tranzila.charge(chargePayload)
    console.log(`[CHARGE][${logId}] Tranzila raw response:`, JSON.stringify(tranzilaResponse))
    

    // ── Cas 1 : Tranzila demande une redirection 3DS ─────────────────
    const tdsData = (tranzilaResponse as any)?.['3ds_data']
    const redirectUrl =
      tdsData?.challengeUrl ||
      (tranzilaResponse as any).redirect_url ||
      (tranzilaResponse as any).three_d_secure_url ||
      (tranzilaResponse as any).acs_url ||
      (tranzilaResponse as any).payment_url

    if (redirectUrl) {
      console.log(`[CHARGE][${logId}] 3DS required → redirect:`, redirectUrl) 

      const trackId = tdsData?.track_id || null

      await supabase
        .from('payment_sessions')
        .update({
          status: 'pending_3ds',
          tranzila_transaction_id: trackId || tranzilaResponse.transaction_id || tranzilaResponse.index || null,
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