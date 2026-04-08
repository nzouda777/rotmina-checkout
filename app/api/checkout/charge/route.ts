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
      name: item.title || 'Product',
      unit_price: item.price,
      units_number: item.quantity,
      type: 'I'
    }))

    // If no items, add a fallback item representing the total
    if (tranzilaItems.length === 0) {
      tranzilaItems.push({
        name: `Order from ${session.shop}`,
        unit_price: session.cart.total,
        units_number: 1,
        type: 'I'
      })
    }

    const chargePayload = {
      card_number: cardNumber.replace(/\s/g, ''),
      expire_month: expireMonth,
      expire_year: expireYear,
      cvv: parseInt(cvv, 10),
      items: tranzilaItems,
      txn_currency_code: session.cart.currency.toUpperCase(),
      txn_type: 'debit',
      email: customerInfo.email,
      card_holder_name: cardholderName || `${customerInfo.firstName} ${customerInfo.lastName}`,
      customer_address: customerInfo.address,
      customer_city: customerInfo.city,
      customer_phone: customerInfo.phone,
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
        error_message: isSuccess ? null : TranzilaClient.getErrorMessage(tranzilaResponse.Response || 'error'),
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
        error: TranzilaClient.getErrorMessage(tranzilaResponse.Response || 'error'),
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
