import type { CartItem } from './types'

const GIFT_CARD_TITLE_KEYWORDS = ['gift card', 'carte cadeau', 'גיפט קארד', 'כרטיס מתנה']

export function isGiftCardProduct(item: CartItem): boolean {
  const configuredHandle = process.env.GIFT_CARD_PRODUCT_HANDLE
  const configuredProductId = process.env.GIFT_CARD_PRODUCT_ID

  console.log(`[GIFT-CARD-CHECK] Checking item: "${item.title}" (Handle: ${item.handle}, ID: ${item.product_id})`)

  if (configuredProductId && item.product_id) {
    if (String(item.product_id) === configuredProductId) {
      console.log(`[GIFT-CARD-CHECK] Match found by product ID: ${configuredProductId}`)
      return true
    }
  }

  if (configuredHandle && item.handle) {
    if (item.handle === configuredHandle) {
      console.log(`[GIFT-CARD-CHECK] Match found by product handle: ${configuredHandle}`)
      return true
    }
  }

  const titleLower = (item.title || '').toLowerCase()
  const match = GIFT_CARD_TITLE_KEYWORDS.some(keyword => titleLower.includes(keyword))
  if (match) {
    console.log(`[GIFT-CARD-CHECK] Match found by title keyword in: "${titleLower}"`)
  }
  return match
}

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
