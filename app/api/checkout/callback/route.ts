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

    // Get current session data first
    const { data: session, error: fetchError } = await supabase
      .from('payment_sessions')
      .select('*')
      .eq('id', index)
      .single()

    if (fetchError || !session) {
      console.error('Error fetching session:', fetchError)
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

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
        tranzila_response: params,
        order_id: shopifyOrderId,
        tranzila_transaction_id: ConfirmationCode || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', index)

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
      ? `${baseUrl}/checkout/success?session=${index}&confirmation=${ConfirmationCode}`
      : `${baseUrl}/checkout/error?session=${index}`

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
