import { createClient } from '@/lib/supabase/server'
import { sendGiftCardEmailToRecipient, sendGiftCardEmailToBuyer } from '@/lib/email'
import type { CartItem } from './types'

// ── Gift Card Product Detection ──────────────────────────────────────────────

const GIFT_CARD_TITLE_KEYWORDS = ['gift card', 'carte cadeau', 'גיפט קארד', 'כרטיס מתנה']

/**
 * Check if a cart item is a gift card product.
 * Matches by title keywords or by a configured product handle/ID.
 */
export function isGiftCardProduct(item: CartItem): boolean {
  const configuredHandle = process.env.GIFT_CARD_PRODUCT_HANDLE
  const configuredProductId = process.env.GIFT_CARD_PRODUCT_ID

  // Match by product ID if configured
  if (configuredProductId && item.product_id) {
    if (String(item.product_id) === configuredProductId) return true
  }

  // Match by product handle if configured
  if (configuredHandle && item.handle) {
    if (item.handle === configuredHandle) return true
  }

  // Match by title keywords
  const titleLower = (item.title || '').toLowerCase()
  return GIFT_CARD_TITLE_KEYWORDS.some(keyword => titleLower.includes(keyword))
}

/**
 * Extract gift card items from a cart.
 * Returns { giftCardItems, regularItems }
 */
export function separateGiftCardItems(items: CartItem[]): {
  giftCardItems: CartItem[]
  regularItems: CartItem[]
} {
  const giftCardItems: CartItem[] = []
  const regularItems: CartItem[] = []

  for (const item of items) {
    if (isGiftCardProduct(item)) {
      giftCardItems.push(item)
    } else {
      regularItems.push(item)
    }
  }

  return { giftCardItems, regularItems }
}

// ── Gift Card Code Generation ────────────────────────────────────────────────

/**
 * Generate a unique gift card code in format: ROTM-XXXX-XXXX-XXXX
 */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // No 0/O/1/I to avoid confusion
  const segments: string[] = ['ROTM']
  for (let s = 0; s < 3; s++) {
    let segment = ''
    for (let i = 0; i < 4; i++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    segments.push(segment)
  }
  return segments.join('-')
}

// ── Database Operations ──────────────────────────────────────────────────────

export interface GiftCardRecord {
  id: string
  code: string
  original_amount: number
  balance: number
  currency: string
  status: 'active' | 'depleted' | 'disabled'
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
}

/**
 * Create a new gift card in the database.
 * Generates a unique code and returns the gift card record.
 */
export async function createGiftCard(params: {
  amount: number
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
  
  // Generate a unique code (retry if collision)
  let code: string
  let attempts = 0
  while (true) {
    code = generateCode()
    const { data: existing } = await supabase
      .from('gift_cards')
      .select('id')
      .eq('code', code)
      .single()
    
    if (!existing) break
    attempts++
    if (attempts > 10) throw new Error('Failed to generate unique gift card code')
  }

  const { data, error } = await supabase
    .from('gift_cards')
    .insert({
      code,
      original_amount: params.amount,
      balance: params.amount,
      currency: params.currency || 'ILS',
      status: 'active',
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

  console.log(`[GIFT-CARD] Created gift card: ${code} for ${params.amount} ${params.currency || 'ILS'}`)
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
  const { giftCardItems } = separateGiftCardItems(params.items)

  if (giftCardItems.length === 0) return []

  const generatedCards: GiftCardRecord[] = []

  for (const item of giftCardItems) {
    // Generate one card per quantity
    for (let q = 0; q < (item.quantity || 1); q++) {
      try {
        const props = item.properties || {}
        const recipientName = props['Recipient name'] || props['recipient_name'] || undefined
        const recipientEmail = props['Recipient email'] || props['recipient_email'] || undefined
        const senderName = props['Your name'] || props['your_name'] || props['sender_name'] || undefined
        const senderEmail = props['Your email'] || props['your_email'] || props['sender_email'] || undefined
        const personalMessage = props['Message'] || props['message'] || undefined

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

        // Attempt to send emails
        let allEmailsSent = true

        if (recipientEmail) {
          const res = await sendGiftCardEmailToRecipient({
            recipientEmail,
            recipientName,
            senderName,
            giftCardCode: card.code,
            amount: item.price,
            currency: params.currency || 'ILS',
            message: personalMessage,
          })
          if (!res.success) allEmailsSent = false
        }

        const buyerMailToUse = senderEmail || params.buyerEmail
        if (buyerMailToUse) {
          const res = await sendGiftCardEmailToBuyer({
            buyerEmail: buyerMailToUse,
            buyerName: senderName,
            recipientName,
            giftCardCode: card.code,
            amount: item.price,
            currency: params.currency || 'ILS',
          })
          if (!res.success) allEmailsSent = false
        }

        if (allEmailsSent && (recipientEmail || buyerMailToUse)) {
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
