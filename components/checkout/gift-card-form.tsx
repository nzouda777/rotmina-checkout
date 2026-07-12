'use client'

import { useState } from 'react'
import { Gift, X, Loader2, CheckCircle2, Percent } from 'lucide-react'
import { useLanguage } from '@/lib/language-context'

interface AppliedGiftCard {
  id: string
  code: string
  balance: number | null
  appliedAmount: number
  discountType: 'amount' | 'percentage'
  discountValue: number | null
}

interface GiftCardFormProps {
  currency: string
  onApply: (giftCard: AppliedGiftCard) => void
  onRemove: () => void
  appliedGiftCard: AppliedGiftCard | null
  orderTotal: number
}

export function GiftCardForm({
  currency,
  onApply,
  onRemove,
  appliedGiftCard,
  orderTotal,
}: GiftCardFormProps) {
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { t } = useLanguage()

  const formatPrice = (amount: number) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(amount)

  const handleApply = async () => {
    if (!code.trim()) {
      setError(t('giftCardForm.enterCode'))
      return
    }

    setIsLoading(true)
    setError('')

    try {
      // Send the cart currency so the server converts the card balance when
      // the card was purchased in another currency (e.g. ILS card on USD checkout).
      const response = await fetch('/api/checkout/gift-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), currency }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Invalid gift card')
        return
      }

      const isPercentage = data.discount_type === 'percentage'
      const appliedAmount = isPercentage
        ? Math.round(orderTotal * (data.discount_value / 100) * 100) / 100
        : Math.min(data.balance ?? 0, orderTotal)

      onApply({
        id: data.id,
        code: data.code,
        balance: data.balance,
        appliedAmount,
        discountType: data.discount_type || 'amount',
        discountValue: data.discount_value,
      })

      setCode('')
      setError('')
    } catch {
      setError(t('giftCardForm.failedValidation'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleApply()
    }
  }

  if (appliedGiftCard) {
    const isPercentage = appliedGiftCard.discountType === 'percentage'
    const remainingBalance =
      !isPercentage && appliedGiftCard.balance != null
        ? appliedGiftCard.balance - appliedGiftCard.appliedAmount
        : null

    return (
      <div className="rounded-lg border border-green-200 bg-green-50/50 dark:border-green-800/50 dark:bg-green-900/10 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-9 w-9 rounded-full bg-green-100 dark:bg-green-900/30">
              {isPercentage
                ? <Percent className="h-5 w-5 text-green-600 dark:text-green-400" />
                : <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              }
            </div>
            <div>
              <p className="text-sm font-medium text-foreground font-mono">
                {appliedGiftCard.code}
              </p>
              <p className="text-xs text-muted-foreground">
                {isPercentage
                  ? <>{appliedGiftCard.discountValue}% {t('giftCardForm.applied')} · {formatPrice(appliedGiftCard.appliedAmount)} saved</>
                  : <>{formatPrice(appliedGiftCard.appliedAmount)} {t('giftCardForm.applied')}
                      {remainingBalance != null && remainingBalance > 0 && (
                        <> · {formatPrice(remainingBalance)} {t('giftCardForm.remainingOnCard')}</>
                      )}
                    </>
                }
              </p>
            </div>
          </div>
          <button
            onClick={onRemove}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800/50 transition-colors flex-shrink-0"
            aria-label={t('giftCardForm.removeGiftCard')}
          >
            <X className="h-3.5 w-3.5" />
            {/* {t('giftCardForm.remove') || 'Retirer'} */}
          </button>
        </div>

        <div className="mt-3 pt-3 border-t border-green-200 dark:border-green-800/50">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('giftCardForm.giftCardWarning')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Gift className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{t('giftCardForm.title')}</span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            if (error) setError('')
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('giftCardForm.placeholder')}
          disabled={isLoading}
          className={`flex-1 px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors text-sm ${
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
              <span>{t('giftCardForm.checking')}</span>
            </>
          ) : (
            t('giftCardForm.apply')
          )}
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
