'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import Image from 'next/image'
import { X, Gift, Copy, Check } from 'lucide-react'
import { useLanguage } from '@/lib/language-context'
import { storeUrl } from '@/lib/store-url'

function SuccessModal() {
  const searchParams = useSearchParams()
  const { t, lang, dir, currency } = useLanguage()
  const giftCardsParam = searchParams.get('gift_cards')
  const usedGcCode = searchParams.get('used_gc')
  const gcRemaining = searchParams.get('gc_remaining')
  const giftCardCodes = giftCardsParam ? giftCardsParam.split(',').filter(Boolean) : []
  const hasGiftCards = giftCardCodes.length > 0

  // "Explore more" must return to the storefront in the checkout language:
  // en → /en/collections/shop, he → /collections/shop
  const exploreUrl = storeUrl(lang, '/collections/shop', currency)

  const titleLines = t('successModal.title').split('\n')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" dir={dir}>
      {/* mobile image */}
      <Image

        src="/checkout/success-bg.webp"
        alt=""
        fill
        className="sm:hidden object-cover object-center"
      />
      <div className="sm:hidden absolute inset-0 bg-black/30" />

      <div
        className="relative flex w-full overflow-hidden bg-white shadow-2xl"
        style={{
          maxWidth: hasGiftCards ? 640 : 560,
          borderRadius: 2,
        }}
      >

        {/* ── Left: product image ── */}
        <div className="relative hidden sm:block" style={{ width: '44%', minHeight: hasGiftCards ? 480 : 380, flexShrink: 0 }}>
          <Image
            src="/checkout/success-bg.webp"
            alt=""
            fill
            className="object-cover object-center"
            priority
          />
        </div>

        {/* ── Right: content ── */}
        <div className="flex flex-1 flex-col items-center justify-center bg-white px-10 py-10 text-center relative">
          {/* Close button */}
          <button
            onClick={() => window.close()}
            aria-label="Close"
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X size={16} strokeWidth={1.5} />
          </button>

          {/* Title */}
          <h1
            dir={dir}
            className="text-[2rem] leading-[1.15] text-gray-900 mb-4"
            style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic' }}
          >
            {titleLines.map((line, i) => (
              <span key={i}>
                {line}
                {i < titleLines.length - 1 && <br />}
              </span>
            ))}
          </h1>

          {/* Body */}
          <p className="text-[0.8rem] text-gray-500 leading-relaxed mb-6" style={{ maxWidth: 195 }}>
            {t('successModal.body')}
          </p>

          {/* Gift cards (conditional) */}
          {hasGiftCards && (
            <div className="w-full mb-5 space-y-2">
              <div className="flex items-center justify-center gap-1.5 mb-3">
                <Gift className="h-4 w-4 text-gray-700" />
                <p className="text-xs font-medium text-gray-700 uppercase tracking-wider">
                  {giftCardCodes.length === 1 ? t('success.yourGiftCard') : t('success.yourGiftCards')}
                </p>
              </div>
              {giftCardCodes.map((code, i) => (
                <GiftCodeRow key={i} code={code} />
              ))}
              <p className="text-[0.7rem] text-amber-600 mt-2">
                ⚠️ {giftCardCodes.length === 1 ? t('success.saveCode') : t('success.saveCodes')}
              </p>
            </div>
          )}

          {usedGcCode && gcRemaining !== null && (
            <div className="w-full mb-5 rounded border border-green-200 bg-green-50/60 p-3 text-left">
              <div className="flex items-center gap-1.5 mb-1">
                <Gift className="h-3.5 w-3.5 text-green-600" />
                <p className="text-xs font-medium text-gray-800">{t('success.giftCardUsed')}</p>
              </div>
              <p className="text-xs text-gray-500">
                {t('success.paidWithGiftCard')}{' '}
                <span className="font-mono text-gray-800">{usedGcCode}</span>.
              </p>
              <p className="text-xs font-medium text-green-600 mt-1">
                {t('success.remainingBalance')}:{' '}
                {new Intl.NumberFormat(lang === 'he' ? 'he-IL' : 'en-IL', {
                  style: 'currency',
                  currency: 'ILS',
                }).format(Number(gcRemaining))}
              </p>
            </div>
          )}

          {/* CTA */}
          <a
            href={exploreUrl}
            className="text-[0.7rem] uppercase tracking-[0.18em] text-gray-900 border-b border-gray-900 pb-px hover:opacity-60 transition-opacity"
          >
            {t('successModal.cta')}
          </a>
        </div>
      </div>
    </div>
  )
}

function GiftCodeRow({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const { t } = useLanguage()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center justify-between rounded border border-dashed border-green-300 bg-green-50/50 px-3 py-2">
      <p className="font-mono text-sm font-bold tracking-wider text-gray-900">{code}</p>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
      >
        {copied ? (
          <><Check className="h-3 w-3 text-green-600" /><span className="text-green-600">{t('success.copied')}</span></>
        ) : (
          <><Copy className="h-3 w-3" /><span>{t('success.copy')}</span></>
        )}
      </button>
    </div>
  )
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 flex items-center justify-center bg-black/60">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    }>
      <SuccessModal />
    </Suspense>
  )
}
