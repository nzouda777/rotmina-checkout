'use client'

import { useState } from 'react'
import { Gift, X, Loader2, CheckCircle2 } from 'lucide-react'

interface GiftCardFormProps {
  currency: string
  onApply: (giftCard: { id: string; code: string; balance: number; appliedAmount: number }) => void
  onRemove: () => void
  appliedGiftCard: { id: string; code: string; balance: number; appliedAmount: number } | null
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

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: currency,
    }).format(amount)
  }

  const handleApply = async () => {
    if (!code.trim()) {
      setError('Please enter a gift card code')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/checkout/gift-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Invalid gift card')
        return
      }

      // Apply the gift card — the applied amount is min(balance, orderTotal)
      const appliedAmount = Math.min(data.balance, orderTotal)

      onApply({
        id: data.id,
        code: data.code,
        balance: data.balance,
        appliedAmount,
      })

      setCode('')
      setError('')
    } catch {
      setError('Failed to validate gift card. Please try again.')
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

  // If a gift card is already applied, show the applied state
  if (appliedGiftCard) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50/50 dark:border-green-800/50 dark:bg-green-900/10 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-9 w-9 rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground font-mono">
                {appliedGiftCard.code}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatPrice(appliedGiftCard.appliedAmount)} applied
                {appliedGiftCard.balance > appliedGiftCard.appliedAmount && (
                  <> · {formatPrice(appliedGiftCard.balance - appliedGiftCard.appliedAmount)} remaining on card</>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onRemove}
            className="flex items-center justify-center h-8 w-8 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
            aria-label="Remove gift card"
          >
            <X className="h-4 w-4 text-muted-foreground hover:text-red-600" />
          </button>
        </div>

        <div className="mt-3 pt-3 border-t border-green-200 dark:border-green-800/50">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠️ Gift card amount is charged in full immediately and is not included in installment plans.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Gift className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Gift card</span>
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
          placeholder="Enter gift card code"
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
              <span>Checking...</span>
            </>
          ) : (
            'Apply'
          )}
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
