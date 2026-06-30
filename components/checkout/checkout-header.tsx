'use client'

import { Lock, ChevronDown } from 'lucide-react'
import Image from 'next/image'
import { useLanguage, CURRENCIES, type Currency } from '@/lib/language-context'

interface CheckoutHeaderProps {
  shopName: string
}

export function CheckoutHeader({ shopName }: CheckoutHeaderProps) {
  const { t, lang, setLang, currency, setCurrency } = useLanguage()

  return (
    <header className="border-b border-border bg-background" dir="ltr">
      <div className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-[1fr_auto_1fr] items-center">
        {/* Left: Language toggle */}
        <div className="fl ex invisible items-center">
          <button
            onClick={() => setLang(lang === 'he' ? 'en' : 'he')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-muted/50 hover:bg-muted transition-colors text-sm font-medium text-foreground"
            aria-label={lang === 'he' ? 'Switch to English' : 'עבור לעברית'}
          >
            <span className="text-base leading-none">{lang === 'he' ? '🇮🇱' : '🇺🇸'}</span>
            <span className="hidden sm:inline text-xs">
              {lang === 'he' ? 'עב' : 'EN'}
            </span>
          </button>
        </div>

        {/* Center: Logo — always truly centered via grid */}
        <div className="flex justify-center">
          <a href="https://rotmina.co">
            <Image
              src="/rotmina-logo_1.webp"
              alt="Rotmina Logo"
              width={200}
              height={100}
              priority
            />
          </a>
        </div>

        {/* Right: Currency selector + lock */}
        <div className="flex items-center gap-3 justify-end">
          <div className="relative flex items-center">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="appearance-none pl-3 pr-7 py-1.5 rounded-full border border-border bg-muted/50 hover:bg-muted transition-colors text-xs font-medium text-foreground cursor-pointer focus:outline-none"
              aria-label="Select currency"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 h-3 w-3 text-muted-foreground pointer-events-none" />
          </div>

          {/* <div className="flex items-center gap-2 text-muted-foreground">
            <Lock className="h-4 w-4" />
            <span className="text-sm hidden sm:inline">{t('header.secureCheckout')}</span>
          </div> */}
        </div>
      </div>
    </header>
  )
}
