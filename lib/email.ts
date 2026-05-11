import { Resend } from 'resend'
import { GiftCardEmail } from '@/components/emails/gift-card-email'
import { GiftCardBuyerEmail } from '@/components/emails/gift-card-buyer-email'
import { OrderConfirmationEmail } from '@/components/emails/order-confirmation-email'
import * as React from 'react'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const fromEmail = process.env.RESEND_FROM_EMAIL || 'Rotmani Store <orders@rotmani.com>'

export async function sendGiftCardEmailToRecipient(params: {
  recipientEmail: string
  recipientName?: string
  senderName?: string
  giftCardCode: string
  amount: number
  currency: string
  message?: string
}) {
  if (!resend) {
    console.warn('[EMAIL] Missing RESEND_API_KEY or uninitialized Resend instance. Skipping email to recipient.')
    return { success: false, error: 'Missing API Key' }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [params.recipientEmail],
      subject: `You received a Gift Card${params.senderName ? ` from ${params.senderName}` : ''}! 🎁`,
      react: React.createElement(GiftCardEmail, {
        recipientName: params.recipientName,
        senderName: params.senderName,
        giftCardCode: params.giftCardCode,
        amount: params.amount,
        currency: params.currency,
        message: params.message,
      }),
    })

    if (error) {
      console.error(`[EMAIL-RECIPIENT] Resend error for ${params.recipientEmail}:`, error)
      return { success: false, error }
    }

    console.log(`[EMAIL-RECIPIENT] Successfully sent to ${params.recipientEmail}. ID: ${data?.id}`)
    return { success: true, data }
  } catch (err: any) {
    console.error('[EMAIL] Exception sending to recipient:', err)
    return { success: false, error: err.message }
  }
}

export async function sendGiftCardEmailToBuyer(params: {
  buyerEmail: string
  buyerName?: string
  recipientName?: string
  giftCardCode: string
  amount: number
  currency: string
}) {
  if (!resend) {
    console.warn('[EMAIL] Missing RESEND_API_KEY or uninitialized Resend instance. Skipping email to buyer.')
    return { success: false, error: 'Missing API Key' }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [params.buyerEmail],
      subject: `Your Gift Card Purchase Confirmation`,
      react: React.createElement(GiftCardBuyerEmail, {
        buyerName: params.buyerName,
        recipientName: params.recipientName,
        giftCardCode: params.giftCardCode,
        amount: params.amount,
        currency: params.currency,
      }),
    })

    if (error) {
      console.error(`[EMAIL-BUYER] Resend error for ${params.buyerEmail}:`, error)
      return { success: false, error }
    }

    console.log(`[EMAIL-BUYER] Successfully sent to ${params.buyerEmail}. ID: ${data?.id}`)
    return { success: true, data }
  } catch (err: any) {
    console.error('[EMAIL] Exception sending to buyer:', err)
    return { success: false, error: err.message }
  }
}

export async function sendOrderConfirmationEmail(params: {
  toEmail: string
  orderName: string
  customerName: string
  items: { title: string; quantity: number; price: number; image?: string }[]
  subtotal: number
  shipping: number
  tax: number
  total: number
  currency: string
  shippingAddress: {
    address: string
    city: string
    postalCode: string
    country: string
  }
  orderStatusUrl?: string
}) {
  if (!resend) {
    console.warn('[EMAIL] Missing RESEND_API_KEY or uninitialized Resend instance. Skipping order confirmation.')
    return { success: false, error: 'Missing API Key' }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [params.toEmail],
      subject: `Order Confirmation - #${params.orderName}`,
      react: React.createElement(OrderConfirmationEmail, {
        orderName: params.orderName,
        customerName: params.customerName,
        items: params.items,
        subtotal: params.subtotal,
        shipping: params.shipping,
        tax: params.tax,
        total: params.total,
        currency: params.currency,
        shippingAddress: params.shippingAddress,
        orderStatusUrl: params.orderStatusUrl,
      }),
    })

    if (error) {
      console.error(`[EMAIL-ORDER] Resend error for ${params.toEmail}:`, error)
      return { success: false, error }
    }

    console.log(`[EMAIL-ORDER] Successfully sent to ${params.toEmail}. ID: ${data?.id}`)
    return { success: true, data }
  } catch (err: any) {
    console.error('[EMAIL] Exception sending order confirmation:', err)
    return { success: false, error: err.message }
  }
}
