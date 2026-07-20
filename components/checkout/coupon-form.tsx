'use client'

import { useState } from 'react'
import { Tag, X, Loader2, CheckCircle2, Percent, Lock } from 'lucide-react'
import type { AppliedCoupon, ShopifyDiscount } from '@/lib/types'
import { useLanguage } from '@/lib/language-context'

interface CouponFormProps {
  currency: string
  // Currently always equal to `currency`/1 — kept for prop-shape compatibility.
  displayCurrency?: string
  displayRate?: number
  orderTotal: number
  shopifyDiscount?: ShopifyDiscount
  appliedCoupon: AppliedCoupon | null
  onApply: (coupon: AppliedCoupon) => void
  onRemove: () => void
}

export function CouponForm({
  currency,
  displayCurrency,
  displayRate = 1,
  orderTotal,
  shopifyDiscount,
  appliedCoupon,
  onApply,
  onRemove,
}: CouponFormProps) {
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { t } = useLanguage()

  const formatPrice = (amount: number) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency: displayCurrency || currency }).format(amount * displayRate)

  // Shopify discount already applied — show as locked/read-only
  // This covers manual discount codes, automatic discounts, and the fallback
  // case where the code name is unknown (codes array is empty).
  if (shopifyDiscount && (shopifyDiscount.amount > 0 || shopifyDiscount.codes.length > 0)) {
    const hasCodes = shopifyDiscount.codes.length > 0

    return (
      <div className="rounded-lg border border-green-200 bg-green-50/50 dark:border-green-800/50 dark:bg-green-900/10 p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-full bg-green-100 dark:bg-green-900/30">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            {hasCodes ? (
              <>
                <p className="text-sm font-medium text-foreground font-mono">
                  {shopifyDiscount.codes.map((c) => c.code).join(', ')}
                </p>
                {shopifyDiscount.amount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {formatPrice(shopifyDiscount.amount)} {t('couponForm.discountApplied')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm font-medium text-foreground">
                {shopifyDiscount.amount > 0
                  ? `${formatPrice(shopifyDiscount.amount)} ${t('couponForm.discountApplied')}`
                  : t('couponForm.discountApplied')}
              </p>
            )}
          </div>
          <Lock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </div>
      </div>
    )
  }

  // Custom coupon applied — show with remove button
  if (appliedCoupon) {
    const isPercentage = appliedCoupon.discountType === 'percentage'
    return (
      <div className="rounded-lg border border-green-200 bg-green-50/50 dark:border-green-800/50 dark:bg-green-900/10 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-9 w-9 rounded-full bg-green-100 dark:bg-green-900/30 flex-shrink-0">
              {isPercentage
                ? <Percent className="h-5 w-5 text-green-600 dark:text-green-400" />
                : <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              }
            </div>
            <div>
              <p className="text-sm font-medium text-foreground font-mono">{appliedCoupon.code}</p>
              <p className="text-xs text-muted-foreground">
                {isPercentage
                  ? <>{appliedCoupon.discountValue}% {t('couponForm.off')} · {formatPrice(appliedCoupon.appliedAmount)} {t('couponForm.saved')}</>
                  : <>{formatPrice(appliedCoupon.appliedAmount)} {t('couponForm.discountApplied')}</>
                }
              </p>
            </div>
          </div>
          <button
            onClick={onRemove}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800/50 transition-colors flex-shrink-0"
            aria-label={t('couponForm.removeCoupon')}
          >
            <X className="h-3.5 w-3.5" />
            {/* {t('couponForm.remove') || 'Retirer'} */}
          </button>
        </div>
      </div>
    )
  }

  const handleApply = async () => {
    if (!code.trim()) {
      setError(t('couponForm.enterCode'))
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/checkout/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        const errorMap: Record<string, string> = {
          NOT_FOUND: t('couponForm.notFound'),
          DISABLED: t('couponForm.disabled'),
          DEPLETED: t('couponForm.depleted'),
          INVALID_INPUT: t('couponForm.enterCode'),
          SERVER_ERROR: t('couponForm.failedValidation'),
        }
        setError(errorMap[data.errorCode] ?? t('couponForm.invalidCode'))
        return
      }

      const isPercentage = data.discount_type === 'percentage'
      const appliedAmount = isPercentage
        ? Math.round(orderTotal * (data.discount_value / 100) * 100) / 100
        : Math.min(data.discount_value, orderTotal)

      onApply({
        id: data.id,
        code: data.code,
        discountType: data.discount_type,
        discountValue: data.discount_value,
        appliedAmount,
      })

      setCode('')
      setError('')
    } catch {
      setError(t('couponForm.failedValidation'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{t('couponForm.title')}</span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase())
            if (error) setError('')
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApply() } }}
          placeholder={t('couponForm.placeholder')}
          disabled={isLoading}
          className={`flex-1 px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors text-sm font-mono ${
            error ? 'border-destructive' : 'border-input'
          }`}
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={isLoading || !code.trim()}
          className="px-5 py-3 rounded-lg border border-input bg-muted/50 text-foreground text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('couponForm.checking')}</span>
            </>
          ) : (
            t('couponForm.apply')
          )}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
