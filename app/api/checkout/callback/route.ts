import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createShopifyOrder } from '@/lib/shopify'
import type { PaymentSession, CustomerInfo } from '@/lib/types'

// Callback from Tranzila after payment
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const params: Record<string, string> = {}
    
    formData.forEach((value, key) => {
      params[key] = value.toString()
    })

    const { Response: responseCode, index, ConfirmationCode } = params

    if (!index) {
      return NextResponse.json(
        { error: 'Missing transaction reference' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const isSuccess = responseCode === '000'

    // Try to find the session ID from merchant_data first, fallback to index
    const sessionId = params.merchant_data || index

    // Get current session data first
    // We try to match by 'id' (UUID) or 'tranzila_transaction_id' (if it was stored during 3DS init)
    const { data: session, error: fetchError } = await supabase
      .from('payment_sessions')
      .select('*')
      .or(`id.eq.${sessionId},tranzila_transaction_id.eq.${sessionId}`)
      .single()

    if (fetchError || !session) {
      console.error('Error fetching session:', fetchError, 'sessionId used:', sessionId)
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    // Use the actual session ID from the database for future updates
    const actualSessionId = session.id

    let shopifyOrderId = session.order_id

    // If payment is successful and we don't have a shopify order yet, create one
    if (isSuccess && !shopifyOrderId && session.customer) {
      try {
        const order = await createShopifyOrder({
          session: session as PaymentSession,
          customer: session.customer as CustomerInfo,
          transactionId: ConfirmationCode,
        })
        shopifyOrderId = String(order.id)
      } catch (err) {
        console.error('Failed to create Shopify order during callback:', err)
        // We still want to mark the payment as successful even if Shopify fails, 
        // because the customer paid. We can handle retry or manual entry later.
      }
    }

    // Update the session
    const { error: updateError } = await supabase
      .from('payment_sessions')
      .update({
        status: isSuccess ? 'paid' : 'failed',
        raw_response: params,
        order_id: shopifyOrderId,
        tranzila_transaction_id: ConfirmationCode || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', actualSessionId)

    if (updateError) {
      console.error('Error updating session:', updateError)
      return NextResponse.json(
        { error: 'Failed to update session' },
        { status: 500 }
      )
    }

    // Redirect to appropriate page
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    const redirectUrl = isSuccess 
      ? `${baseUrl}/checkout/success?session=${actualSessionId}&confirmation=${ConfirmationCode}`
      : `${baseUrl}/checkout/error?session=${actualSessionId}`

    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    console.error('Callback processing error:', error)
    return NextResponse.json(
      { error: 'Callback processing failed' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  // Handle GET callback from Tranzila (some configurations use GET)
  const { searchParams } = new URL(request.url)
  const params: Record<string, string> = {}
  
  searchParams.forEach((value, key) => {
    params[key] = value
  })

  const formData = new FormData()
  Object.entries(params).forEach(([key, value]) => {
    formData.append(key, value)
  })

  // Reuse POST logic
  const postRequest = new NextRequest(request.url, {
    method: 'POST',
    body: formData,
  })

  return POST(postRequest)
}
