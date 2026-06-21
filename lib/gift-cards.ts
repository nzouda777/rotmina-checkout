import { createClient } from '@/lib/supabase/server'
import { sendGiftCardEmailToRecipient, sendGiftCardEmailToBuyer } from '@/lib/email'
import type { CartItem } from './types'
import { isGiftCardProduct, separateGiftCardItems } from './gift-card-utils'
export { isGiftCardProduct, separateGiftCardItems } from './gift-card-utils'

// ── Gift Card Code Generation ────────────────────────────────────────────────

/**
 * Generate a unique gift card code in format: ROTM-XXXX-XXXX-X (Total 16 chars)
 */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // No 0/O/1/I to avoid confusion
  let code = 'ROTM-'
  
  // 4 chars
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  code += '-'
  
  // 4 chars
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  code += '-'
  
  // 1 char (to reach exactly 16)
  code += chars.charAt(Math.floor(Math.random() * chars.length))
  
  return code
}

// ── Database Operations ──────────────────────────────────────────────────────

export interface GiftCardRecord {
  id: string
  code: string
  original_amount: number | null
  balance: number | null
  currency: string
  status: 'active' | 'depleted' | 'disabled'
  discount_type: 'amount' | 'percentage'
  discount_value: number | null
  purchased_session_id: string | null
  purchased_order_id: string | null
  buyer_email: string | null
  recipient_name?: string | null
  recipient_email?: string | null
  sender_name?: string | null
  sender_email?: string | null
  personal_message?: string | null
  email_sent?: boolean
  created_at: string
  updated_at?: string
  last_used_at?: string | null
}

/**
 * Create a new gift card in the database.
 * Generates a unique code and returns the gift card record.
 */
export async function createGiftCard(params: {
  amount?: number
  discountType?: 'amount' | 'percentage'
  discountValue?: number
  code?: string
  currency?: string
  sessionId?: string
  orderId?: string
  buyerEmail?: string
  recipientName?: string
  recipientEmail?: string
  senderName?: string
  senderEmail?: string
  personalMessage?: string
}): Promise<GiftCardRecord> {
  const supabase = await createClient()
  const discountType = params.discountType || 'amount'

  let code: string
  if (params.code) {
    // Use provided code (normalize to uppercase)
    code = params.code.trim().toUpperCase()
    const { data: existing } = await supabase
      .from('gift_cards')
      .select('id')
      .eq('code', code)
      .single()
    if (existing) throw new Error(`Gift card code already exists: ${code}`)
  } else {
    // Auto-generate a unique code (retry if collision)
    let attempts = 0
    code = generateCode()
    while (true) {
      const { data: existing } = await supabase
        .from('gift_cards')
        .select('id')
        .eq('code', code)
        .single()
      if (!existing) break
      attempts++
      if (attempts > 10) throw new Error('Failed to generate unique gift card code')
      code = generateCode()
    }
  }

  const isPercentage = discountType === 'percentage'

  const { data, error } = await supabase
    .from('gift_cards')
    .insert({
      code,
      original_amount: isPercentage ? null : (params.amount ?? null),
      balance: isPercentage ? null : (params.amount ?? null),
      currency: params.currency || 'ILS',
      status: 'active',
      discount_type: discountType,
      discount_value: isPercentage ? (params.discountValue ?? null) : null,
      purchased_session_id: params.sessionId || null,
      purchased_order_id: params.orderId || null,
      buyer_email: params.buyerEmail || null,
      recipient_name: params.recipientName || null,
      recipient_email: params.recipientEmail || null,
      sender_name: params.senderName || null,
      sender_email: params.senderEmail || null,
      personal_message: params.personalMessage || null,
      email_sent: false,
    })
    .select()
    .single()

  if (error || !data) {
    console.error('[GIFT-CARD] Failed to create gift card:', error)
    throw new Error('Failed to create gift card')
  }

  const label = isPercentage
    ? `${params.discountValue}%`
    : `${params.amount} ${params.currency || 'ILS'}`
  console.log(`[GIFT-CARD] Created ${discountType} gift card: ${code} — ${label}`)
  return data as GiftCardRecord
}

/**
 * Validate a gift card code and return its info.
 * Returns null if the code is invalid, depleted, or disabled.
 */
export async function validateGiftCard(code: string): Promise<GiftCardRecord | null> {
  const supabase = await createClient()
  
  // Normalize code: uppercase, trim
  const normalizedCode = code.trim().toUpperCase()

  const { data, error } = await supabase
    .from('gift_cards')
    .select('*')
    .eq('code', normalizedCode)
    .single()

  if (error || !data) {
    console.log(`[GIFT-CARD] Code not found: ${normalizedCode}`)
    return null
  }

  return data as GiftCardRecord
}

/**
 * Debit a gift card balance after successful payment.
 * Sets status to 'depleted' if balance reaches 0.
 */
export async function debitGiftCard(params: {
  code: string
  amount: number
  sessionId?: string
}): Promise<GiftCardRecord> {
  const supabase = await createClient()
  const normalizedCode = params.code.trim().toUpperCase()

  // Fetch current balance
  const { data: card, error: fetchError } = await supabase
    .from('gift_cards')
    .select('*')
    .eq('code', normalizedCode)
    .eq('status', 'active')
    .single()

  if (fetchError || !card) {
    throw new Error(`Gift card not found or not active: ${normalizedCode}`)
  }

  // Percentage cards are single-use — just mark depleted, no balance tracking
  if (card.discount_type === 'percentage') {
    const { data: updated, error: updateError } = await supabase
      .from('gift_cards')
      .update({ status: 'depleted', last_used_at: new Date().toISOString() })
      .eq('id', card.id)
      .select()
      .single()

    if (updateError || !updated) {
      throw new Error(`Failed to debit gift card: ${updateError?.message}`)
    }
    console.log(`[GIFT-CARD] Depleted percentage card ${normalizedCode}`)
    return updated as GiftCardRecord
  }

  const currentBalance = Number(card.balance)
  const debitAmount = Math.min(params.amount, currentBalance)
  const newBalance = Math.max(currentBalance - debitAmount, 0)
  const newStatus = newBalance <= 0 ? 'depleted' : 'active'

  const { data: updated, error: updateError } = await supabase
    .from('gift_cards')
    .update({
      balance: newBalance,
      status: newStatus,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', card.id)
    .select()
    .single()

  if (updateError || !updated) {
    throw new Error(`Failed to debit gift card: ${updateError?.message}`)
  }

  console.log(`[GIFT-CARD] Debited ${normalizedCode}: ${debitAmount} → balance: ${newBalance} (${newStatus})`)
  return updated as GiftCardRecord
}

/**
 * Generate gift card codes for all gift card items in a cart.
 * Called after successful payment.
 */
export async function generateGiftCardsForOrder(params: {
  items: CartItem[]
  sessionId: string
  orderId?: string
  buyerEmail?: string
  currency?: string
}): Promise<GiftCardRecord[]> {
  const { giftCardItems, regularItems } = separateGiftCardItems(params.items)

  console.log(`[GIFT-CARD-GEN] Processing order. Total items: ${params.items.length}, Gift card items found: ${giftCardItems.length}`)

  if (giftCardItems.length === 0) {
    console.log(`[GIFT-CARD-GEN] No gift card items to process for session ${params.sessionId}`)
    return []
  }

  const generatedCards: GiftCardRecord[] = []

  for (const item of giftCardItems) {
    console.log(`[GIFT-CARD-GEN] Generating cards for item: ${item.title}, Quantity: ${item.quantity || 1}`)
    
    // Generate one card per quantity
    for (let q = 0; q < (item.quantity || 1); q++) {
      try {
        console.log(`[GIFT-CARD-GEN] Generating card #${q + 1} for item ${item.title}...`)
        const props = item.properties || {}
        console.log(`[GIFT-CARD-GEN] Item properties for ${item.title}:`, JSON.stringify(props))
        const recipientName = props['Recipient name'] || props['recipient_name'] || props['שם המקבלת'] || undefined
        const recipientEmail = props['Recipient email'] || props['recipient_email'] || props['מייל המקבלת'] || undefined
        const senderName = props['Your name'] || props['your_name'] || props['sender_name'] || props['שם השולח/ת'] || undefined
        const senderEmail = props['Your email'] || props['your_email'] || props['sender_email'] || props['מייל השולח/ת'] || undefined
        const personalMessage = props['Message'] || props['message'] || props['ברכה אישית'] || undefined

        const card = await createGiftCard({
          amount: item.price,
          currency: params.currency || 'ILS',
          sessionId: params.sessionId,
          orderId: params.orderId,
          buyerEmail: params.buyerEmail,
          recipientName,
          recipientEmail,
          senderName,
          senderEmail,
          personalMessage,
        })
        
        generatedCards.push(card)

        // ── Send emails ───────────────────────────────────────────────────────
        // Rule:
        //  • Gift card receiver  → always gets GiftCardEmail (the prominent code email).
        //    If a recipientEmail is set that email goes to them; otherwise the buyer
        //    IS the receiver and gets it themselves.
        //  • Gift card buyer     → always gets GiftCardBuyerEmail (purchase confirmation
        //    with code) as long as we have their email address.
        //    Exception: if buyer == receiver (same address), skip the buyer-confirmation
        //    to avoid sending two nearly-identical emails to the same inbox.

        const buyerMailToUse = senderEmail || params.buyerEmail
        const receiverEmail = recipientEmail || buyerMailToUse  // fall back to buyer when no recipient
        const buyerIsSameAsRecipient = !recipientEmail || recipientEmail === buyerMailToUse

        let allEmailsSent = true

        // 1. Gift card email → receiver
        if (receiverEmail) {
          console.log(`[GIFT-CARD-GEN] Sending gift card email to RECEIVER: ${receiverEmail}`)
          const res = await sendGiftCardEmailToRecipient({
            recipientEmail: receiverEmail,
            recipientName: recipientEmail ? recipientName : (senderName || recipientName),
            senderName: recipientEmail ? senderName : undefined,
            giftCardCode: card.code,
            amount: item.price,
            currency: params.currency || 'ILS',
            message: personalMessage,
          })
          if (!res.success) {
            console.error(`[GIFT-CARD-GEN] Failed to send gift card email to receiver ${receiverEmail}:`, res.error)
            allEmailsSent = false
          } else {
            console.log(`[GIFT-CARD-GEN] Gift card email sent to receiver: ${receiverEmail}`)
          }
        }

        // 2. Buyer confirmation email → buyer (skip when buyer == receiver to avoid duplicate)
        if (buyerMailToUse && !buyerIsSameAsRecipient) {
          console.log(`[GIFT-CARD-GEN] Sending buyer confirmation email to BUYER: ${buyerMailToUse}`)
          const res = await sendGiftCardEmailToBuyer({
            buyerEmail: buyerMailToUse,
            buyerName: senderName,
            recipientName,
            giftCardCode: card.code,
            amount: item.price,
            currency: params.currency || 'ILS',
          })
          if (!res.success) {
            console.error(`[GIFT-CARD-GEN] Failed to send buyer email to ${buyerMailToUse}:`, res.error)
            allEmailsSent = false
          } else {
            console.log(`[GIFT-CARD-GEN] Buyer confirmation email sent to: ${buyerMailToUse}`)
          }
        }

        if (allEmailsSent && receiverEmail) {
          const supabase = await createClient()
          await supabase
            .from('gift_cards')
            .update({ email_sent: true })
            .eq('id', card.id)
        }

      } catch (err) {
        console.error(`[GIFT-CARD] Failed to generate card for item ${item.title}:`, err)
      }
    }
  }

  console.log(`[GIFT-CARD] Generated ${generatedCards.length} gift card(s) for order`)
  return generatedCards
}
