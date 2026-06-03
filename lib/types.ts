export interface CartItem {
  id: string
  title: string
  quantity: number
  price: number
  image?: string
  variant?: string
  sku?: string
  variant_id?: string | number
  product_id?: string | number
  handle?: string
  url?: string
  properties?: Record<string, string>
}

export interface CustomerInfo {
  email: string
  firstName: string
  lastName: string
  address: string
  city: string
  postalCode: string
  country: string
  phone: string
}

export interface CartData {
  items: CartItem[]
  subtotal: number
  shipping: number
  tax: number
  total: number
  currency: string
}

export interface PaymentSession {
  id: string
  shop: string
  idempotency_key: string
  cart: CartData
  customer: CustomerInfo | null
  status: 'pending' | 'processing' | 'paid' | 'failed' | 'expired'
  amount: number
  currency: string
  draft_order_id: string | null
  order_id: string | null
  tranzila_transaction_id: string | null
  raw_response: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface TranzilaConfig {
  terminalName: string
  terminalPassword?: string
  testMode: boolean
}

export interface TranzilaChargeParams {
  sum: number
  currency: string
  ccno: string
  expdate: string
  mycvv: string
  cred_type?: string
  myid?: string
  email?: string
  contact?: string
  company?: string
  address?: string
  city?: string
  phone?: string
  fax?: string
  remarks?: string
  pdesc?: string
  TranzilaTK?: string
  tranmode?: string
}

export interface TranzilaResponse {
  Response: string
  index?: string
  ConfirmationCode?: string
  CcId?: string
  last4?: string
  expmonth?: string
  expyear?: string
  cardtype?: string
  cardissuer?: string
  cardaquirer?: string
  Tempref?: string
  [key: string]: string | undefined
}

export interface GiftCardInfo {
  id: string
  code: string // full code (custom system, e.g. ROTM-XXXX-XXXX-XXXX)
  balance: number
  currency: string
  appliedAmount: number
}

export interface ShopifyOrderCreateData {
  session: PaymentSession
  customer: CustomerInfo
  transactionId?: string
  giftCard?: GiftCardInfo
}
