'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { CheckCircle, Gift, Copy, Check } from 'lucide-react'
import { useLanguage } from '@/lib/language-context'

function SuccessContent() {
  const searchParams = useSearchParams()
  const { t } = useLanguage()
  const confirmation = searchParams.get('confirmation')
  const giftCardsParam = searchParams.get('gift_cards')
  const usedGcCode = searchParams.get('used_gc')
  const gcRemaining = searchParams.get('gc_remaining')

  // Parse gift card codes from query params (comma-separated)
  const giftCardCodes = giftCardsParam ? giftCardsParam.split(',').filter(Boolean) : []

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-green-100 mb-6">
          <CheckCircle className="h-10 w-10 text-green-600" />
        </div>
        
        <h1 className="text-3xl font-bold text-foreground mb-2">
          {t('success.paymentSuccessful')}
        </h1>
        
        <p className="text-muted-foreground mb-6">
          {t('success.thankYou')}
        </p>

        {confirmation && (
          <div className="bg-muted/50 rounded-lg p-4 mb-6">
            <p className="text-sm text-muted-foreground mb-1">{t('success.confirmationCode')}</p>
            <p className="text-lg font-mono font-semibold text-foreground">{confirmation}</p>
          </div>
        )}

        {/* Used Gift Card Info */}
        {usedGcCode && gcRemaining !== null && (
          <div className="bg-green-50/50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/50 rounded-lg p-4 mb-6 text-left">
            <div className="flex items-center gap-2 mb-2">
              <Gift className="h-4 w-4 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium text-foreground">{t('success.giftCardUsed')}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('success.paidWithGiftCard')} <span className="font-mono text-foreground">{usedGcCode}</span>.
            </p>
            <p className="text-sm font-medium text-green-600 dark:text-green-400 mt-2">
              {t('success.remainingBalance')}: {
                new Intl.NumberFormat('he-IL', {
                  style: 'currency',
                  currency: 'ILS', // fallback to ILS if unknown
                }).format(Number(gcRemaining))
              }
            </p>
          </div>
        )}

        {/* Generated Gift Card Codes */}
        {giftCardCodes.length > 0 && (
          <div className="mt-6 mb-6">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Gift className="h-5 w-5 text-foreground" />
              <h2 className="text-lg font-semibold text-foreground">
                {giftCardCodes.length === 1 ? t('success.yourGiftCard') : t('success.yourGiftCards')}
              </h2>
            </div>

            <div className="space-y-3">
              {giftCardCodes.map((code, index) => (
                <GiftCardCodeDisplay key={index} code={code} />
              ))}
            </div>

            <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                ⚠️ {giftCardCodes.length === 1 ? t('success.saveCode') : t('success.saveCodes')}
              </p>
            </div>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {t('success.confirmationEmailSent')}
        </p>
      </div>
    </div>
  )
}

function GiftCardCodeDisplay({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const { t } = useLanguage()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for browsers without clipboard API
      const textArea = document.createElement('textarea')
      textArea.value = code
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="rounded-lg border-2 border-dashed border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30">
            <Gift className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="text-left">
            <p className="text-xs text-muted-foreground mb-0.5">{t('success.giftCardCode')}</p>
            <p className="text-lg font-mono font-bold text-foreground tracking-wider">
              {code}
            </p>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-background border border-border hover:bg-muted transition-colors text-sm"
          title="Copy to clipboard"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-green-600">{t('success.copied')}</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t('success.copy')}</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
      </div>
    }>
      <SuccessContent />
    </Suspense>
  )
}
