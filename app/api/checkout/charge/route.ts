import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import type { PaymentSession, CustomerInfo } from '@/lib/types'

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
      cardholderName 
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

    // Get session
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

    // Update session to processing
    console.log(`[CHARGE][${logId}] Updating session status to 'processing'...`)
    await supabase
      .from('payment_sessions')
      .update({ 
        status: 'processing',
        customer: customerInfo as CustomerInfo,
      })
      .eq('id', sessionId)

    // Process payment with Tranzila
    const tranzila = createTranzilaClient()
    
    // Split expiry date (MM/YY)
    const [month, year] = expiryDate.split('/')
    const expireMonth = parseInt(month, 10)
    const expireYear = parseInt(`20${year}`, 10)
    
    // Map cart items
    console.log(`[CHARGE][${logId}] Mapping ${session.cart.items?.length || 0} items for Tranzila...`)
    const tranzilaItems = (session.cart.items || []).map((item: any) => ({
      name: String(item.title || 'Product'),
      unit_price: Number(item.price),
      units_number: Number(item.quantity) || 1,
      unit_type: 0,
      type: 'I',
      currency_code: session.cart.currency.toUpperCase()
    }))

    // If no items, add a fallback item representing the total
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

    const chargePayload = {
      terminal_name: process.env.TRANZILA_TERMINAL || '',
      txn_currency_code: session.cart.currency.toUpperCase(),
      txn_type: 'debit',
      expire_month: Number(expireMonth),
      expire_year: Number(expireYear),
      cvv: String(cvv),
      card_number: String(cardNumber.replace(/\s/g, '')),
      payment_plan: 1,
      installments_number: 1,
      card_holder_id: null,
      client: {
        email: customerInfo.email,
        name: cardholderName || `${customerInfo.firstName} ${customerInfo.lastName}`,
        address_line_1: customerInfo.address,
        city: customerInfo.city,
        phone_number: customerInfo.phone,
        country_code: null,
        zip: null,
      },
      items: tranzilaItems,
    }

    console.log(`[CHARGE][${logId}] Calling Tranzila API...`)
    
    const tranzilaResponse = await tranzila.charge(chargePayload)

    const isSuccess = TranzilaClient.isSuccess(tranzilaResponse)
    console.log(`[CHARGE][${logId}] Tranzila result success:`, isSuccess, 'Response code:', tranzilaResponse.Response)

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

    // Update session with result
    console.log(`[CHARGE][${logId}] Updating session final status...`)
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

    console.log(`[CHARGE][${logId}] Request completed successfully`)

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
  } catch (error: any) {
    console.error(`[CHARGE][${logId}] CRITICAL ERROR:`, error)
    return NextResponse.json(
      { error: 'Payment processing failed', detail: error.message },
      { status: 500 }
    )
  }
}
