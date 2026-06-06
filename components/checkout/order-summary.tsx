'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { CartData } from '@/lib/types'
import { useLanguage } from '@/lib/language-context'
import { getProductTitle, translateVariant } from '@/lib/translations'

interface OrderSummaryProps {
  cartData: CartData
  giftCardAmount?: number
  giftCardCode?: string
}
export function OrderSummary({ cartData, giftCardAmount = 0, giftCardCode }: OrderSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const { t, lang } = useLanguage()

  const finalTotal = Math.max(cartData.total - giftCardAmount, 0)

  console.log(cartData)
  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: cartData.currency,
    }).format(amount)
  }

  return (
    <div className="bg-muted/30 rounded-lg border border-border">
      {/* Mobile Toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full lg:hidden flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-foreground" />
          <span className="text-sm font-medium text-foreground">
            {isExpanded ? t('orderSummary.hideOrderSummary') : t('orderSummary.showOrderSummary')}
          </span>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <span className="text-lg font-semibold text-foreground">
          {formatPrice(finalTotal)}
        </span>
      </button>

      {/* Order Items */}
      <div className={`${isExpanded ? 'block' : 'hidden lg:block'} p-4 lg:p-6`}>
        <h2 className="hidden lg:block text-lg font-semibold text-foreground mb-4">
          {t('orderSummary.title')}
        </h2>

        {lang === 'en' && (
          <div className="mb-4 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-snug dark:bg-amber-950/30 dark:border-amber-800/40 dark:text-amber-300">
            {t('orderSummary.shippingNotice')}
          </div>
        )}

        <div className="space-y-4">
          {cartData.items.map((item) => (
            <div key={item.id} className="flex gap-4">
              <div className="relative">
                <div className="h-16 w-16 rounded-lg border border-border bg-background overflow-hidden">
                  {item.image ? (
                    <img
                      src={item.product?.featured_image || item.image}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center bg-muted">
                      <Package className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                </div>
                {item.quantity > 1 && (
                  <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-foreground text-background text-xs flex items-center justify-center font-medium">
                    {item.quantity}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {getProductTitle(item.handle, item.title, lang, item.url)}
                </p>
                {item.variant && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {translateVariant(item.variant, lang)}
                  </p>
                )}
              </div>
              <div className="text-sm font-medium text-foreground">
                {formatPrice(item.price * item.quantity)}
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-border my-4" />

        {/* Totals */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('orderSummary.subtotal')}</span>
            <span className="text-foreground">{formatPrice(cartData.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('orderSummary.shipping')}</span>
            <span className="text-foreground">
              {cartData.shipping === 0 ? t('orderSummary.free') : formatPrice(cartData.shipping)}
            </span>
          </div>
          {cartData.tax > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('orderSummary.tax')}</span>
              <span className="text-foreground">{formatPrice(cartData.tax)}</span>
            </div>
          )}

          {/* Gift Card Discount Line */}
          {giftCardAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                <GiftIcon className="h-3.5 w-3.5" />
                {t('orderSummary.giftCard')}{giftCardCode ? ` ${giftCardCode}` : ''}
              </span>
              <span className="text-green-600 dark:text-green-400 font-medium">
                −{formatPrice(giftCardAmount)}
              </span>
            </div>
          )}
        </div>

        {/* Total */}
        <div className="border-t border-border mt-4 pt-4">
          <div className="flex justify-between items-center">
            <span className="text-base font-medium text-foreground">{t('orderSummary.total')}</span>
            <div className="text-right">
              {giftCardAmount > 0 && (
                <span className="text-sm text-muted-foreground line-through ltr:mr-2 rtl:ml-2">
                  {formatPrice(cartData.total)}
                </span>
              )}
              <span className="text-2xl font-semibold text-foreground">
                {formatPrice(finalTotal)}
              </span>
            </div>
          </div>
        </div>

        {/* Return to site */}
        <div className="border-t border-border mt-4 pt-4 flex justify-center">
          <a
            href={process.env.NEXT_PUBLIC_STORE_URL ?? '/collections/shop'}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('orderSummaryExtra.keepExploring')}
          </a>
        </div>
      </div>
    </div>
  )
}

function ShoppingCart({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  )
}

function Package({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  )
}

function GiftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 12v10H4V12M2 7h20v5H2V7zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
    </svg>
  )
}
