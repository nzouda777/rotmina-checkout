'use client'

import { Lock } from 'lucide-react'
import Image from 'next/image'
import { useLanguage } from '@/lib/language-context'

interface CheckoutHeaderProps {
  shopName: string
}

export function CheckoutHeader({ shopName }: CheckoutHeaderProps) {
  const { t, lang, setLang } = useLanguage()

  return (
    <header className="border-b border-border bg-background" dir="ltr">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <div></div>
        <div className="flex items-center gap-3">
          <a href='https://rotmina.co' className="text-xl font-semibold text-foreground">
            <Image
              src="/rotmina-logo_1.webp"
              alt="Rotmina Logo"
              width={200}
              height={100}
            />
          </a>
        </div>
        <div className="flex items-center gap-3">
          {/* Language Toggle */}
          <button
            onClick={() => setLang(lang === 'he' ? 'en' : 'he')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-muted/50 hover:bg-muted transition-colors text-sm font-medium text-foreground"
            aria-label={lang === 'he' ? 'Switch to English' : 'עבור לעברית'}
          >
            <span className="text-base leading-none">{lang === 'he' ? '🇬🇧' : '🇮🇱'}</span>
            <span className="hidden sm:inline text-xs">
              {lang === 'he' ? 'EN' : 'עב'}
            </span>
          </button>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Lock className="h-4 w-4" />
            <span className="text-sm hidden sm:inline">{t('header.secureCheckout')}</span>
          </div>
        </div>
      </div>
    </header>
  )
}

function formatShopName(domain: string): string {
  return domain
    .replace('.myshopify.com', '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
