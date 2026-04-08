import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTranzilaClient, TranzilaClient } from '@/lib/tranzila'
import { createShopifyOrder } from '@/lib/shopify'
import type { PaymentSession, CustomerInfo } from '@/lib/types'

export async function POST(request: NextRequest) {
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

    if (!sessionId || !customerInfo || !cardNumber || !expiryDate || !cvv) {
      return NextResponse.json(
        { error: 'Missing required payment information' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Get session
    const { data: session, error: sessionError } = await supabase
      .from('payment_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Payment session not found' },
        { status: 404 }
      )
    }

    if (session.status !== 'pending') {
      return NextResponse.json(
        { error: 'Payment session already processed' },
        { status: 400 }
      )
    }

    // Update session to processing
    await supabase
      .from('payment_sessions')
      .update({ 
        status: 'processing',
        customer: customerInfo as CustomerInfo,
      })
      .eq('id', sessionId)

    // Process payment with Tranzila
    const tranzila = createTranzilaClient()
    
    // Format expiry date (MMYY)
    const formattedExpiry = expiryDate.replace('/', '')
    
    console.log('[DEBUG] ATTEMPTING CHARGE:', {
      sessionId,
      amount: session.cart.total,
      currency: session.cart.currency,
      email: customerInfo.email,
    })

    const tranzilaResponse = await tranzila.charge({
      sum: session.cart.total,
      currency: getCurrencyCode(session.cart.currency),
      ccno: cardNumber.replace(/\s/g, ''),
      expdate: formattedExpiry,
      mycvv: cvv,
      email: customerInfo.email,
      contact: cardholderName || `${customerInfo.firstName} ${customerInfo.lastName}`,
      address: customerInfo.address,
      city: customerInfo.city,
      phone: customerInfo.phone,
      pdesc: `Order from ${session.shop}`,
    })

    const isSuccess = TranzilaClient.isSuccess(tranzilaResponse)
    let shopifyOrderId = session.order_id

    if (isSuccess && !shopifyOrderId) {
      try {
        const order = await createShopifyOrder({
          session: session as PaymentSession,
          customer: customerInfo,
          transactionId: tranzilaResponse.ConfirmationCode,
        })
        shopifyOrderId = String(order.id)
      } catch (err) {
        console.error('Failed to create Shopify order during charge:', err)
      }
    }

    // Update session with result
    await supabase
      .from('payment_sessions')
      .update({
        status: isSuccess ? 'paid' : 'failed',
        raw_response: tranzilaResponse as any,
        order_id: shopifyOrderId,
        tranzila_transaction_id: tranzilaResponse.ConfirmationCode || null,
        error_message: isSuccess ? null : TranzilaClient.getErrorMessage(tranzilaResponse.Response),
      })
      .eq('id', sessionId)

    if (isSuccess) {
      return NextResponse.json({
        success: true,
        confirmationCode: tranzilaResponse.ConfirmationCode,
        message: 'Payment processed successfully',
      })
    } else {
      return NextResponse.json({
        success: false,
        error: TranzilaClient.getErrorMessage(tranzilaResponse.Response),
      })
    }
  } catch (error) {
    console.error('Payment processing error:', error)
    return NextResponse.json(
      { error: 'Payment processing failed' },
      { status: 500 }
    )
  }
}

function getCurrencyCode(currency: string): string {
  const currencyMap: Record<string, string> = {
    'ILS': '1',
    'USD': '2',
    'EUR': '3',
    'GBP': '4',
  }
  return currencyMap[currency.toUpperCase()] || '1'
}
