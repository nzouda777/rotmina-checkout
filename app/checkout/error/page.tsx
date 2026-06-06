'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { X } from 'lucide-react'
import { useLanguage } from '@/lib/language-context'

function ErrorModal() {
  const searchParams = useSearchParams()
  const { t, dir } = useLanguage()
  const sessionId = searchParams.get('session')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" dir={dir}>
      <div
        className="relative flex w-full overflow-hidden bg-white shadow-2xl"
        style={{ maxWidth: 560, borderRadius: 2 }}
      >
        {/* ── Left: product image ── */}
        <div className="relative hidden sm:block" style={{ width: '44%', minHeight: 380, flexShrink: 0 }}>
          <Image
            src="/checkout/error-bg.webp"
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
            className="text-[2.4rem] leading-[1.1] text-gray-900 mb-4"
            style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic' }}
          >
            {t('errorModal.title')}
          </h1>

          {/* Body */}
          <p className="text-[0.8rem] text-gray-500 leading-relaxed mb-6" style={{ maxWidth: 195 }}>
            {t('errorModal.body')}
          </p>

          {/* CTA */}
          {sessionId ? (
            <Link
              href={`/checkout/${sessionId}`}
              className="text-[0.82rem] text-gray-900 underline underline-offset-2 hover:opacity-60 transition-opacity"
            >
              {t('errorModal.cta')}
            </Link>
          ) : (
            <button
              onClick={() => window.history.back()}
              className="text-[0.82rem] text-gray-900 underline underline-offset-2 hover:opacity-60 transition-opacity"
            >
              {t('errorModal.cta')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ErrorPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 flex items-center justify-center bg-black/60">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    }>
      <ErrorModal />
    </Suspense>
  )
}
