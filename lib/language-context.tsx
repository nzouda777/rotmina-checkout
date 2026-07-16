'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { translations, type Language } from './translations'

// Display currencies offered in the header selector. The Tranzila terminal
// can only charge ILS or USD (see lib/currency.ts) — any other selection here
// is converted to USD server-side (toPayableCurrency/convertCart in the
// session PATCH route) before the customer is charged, so it's safe to offer
// more display currencies without risking a wrong-currency charge (bug #2).
export type Currency = 'USD' | 'EUR' | 'CAD' | 'GBP' | 'CHF' | 'ILS'
export const CURRENCIES: Currency[] = ['USD', 'EUR', 'CAD', 'GBP', 'CHF', 'ILS']

interface LanguageContextType {
  lang: Language
  setLang: (lang: Language) => void
  t: (key: string) => string
  dir: 'ltr' | 'rtl'
  currency: Currency
  setCurrency: (c: Currency) => void
}

const LanguageContext = createContext<LanguageContextType | null>(null)

/**
 * Resolve a dot-notation key like "checkout.cart" into the translation value
 * for the current language.
 */
function getTranslation(key: string, lang: Language): string {
  const parts = key.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = translations

  for (const part of parts) {
    if (current[part] === undefined) {
      console.warn(`[i18n] Missing translation key: "${key}"`)
      return key // fallback: return the key itself
    }
    current = current[part]
  }

  // At this point, `current` should be { en: '...', he: '...' }
  if (current && typeof current === 'object' && lang in current) {
    return current[lang]
  }

  console.warn(`[i18n] Key "${key}" is not a valid translation entry`)
  return key
}

function resolveInitialLang(): Language {
  if (typeof window === 'undefined') return 'he'
  const urlParam = new URLSearchParams(window.location.search).get('language')
  if (urlParam === 'en' || urlParam === 'he') {
    try { localStorage.setItem('rotmina-lang', urlParam) } catch {}
    return urlParam
  }
  try {
    const saved = localStorage.getItem('rotmina-lang')
    if (saved === 'en' || saved === 'he') return saved
  } catch {}
  return 'he'
}

// Default currency follows the checkout language: USD for English, ILS for
// Hebrew. A previously saved currency choice is deliberately NOT restored —
// the default at open must always match the language (the user can still
// switch manually via the header selector during the session).
function resolveInitialCurrency(): Currency {
  if (typeof window === 'undefined') return 'ILS'
  const urlParam = new URLSearchParams(window.location.search).get('language')
  if (urlParam === 'en') return 'USD'
  if (urlParam === 'he') return 'ILS'
  try {
    const savedLang = localStorage.getItem('rotmina-lang')
    return savedLang === 'en' ? 'USD' : 'ILS'
  } catch {}
  return 'ILS'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(resolveInitialLang)
  const [currency, setCurrencyState] = useState<Currency>(resolveInitialCurrency)

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang)
    try { localStorage.setItem('rotmina-lang', newLang) } catch {}
    // Currency follows the language: English → USD, Hebrew → ILS.
    setCurrencyState(newLang === 'en' ? 'USD' : 'ILS')
    // Keep URL query param in sync so the language survives refresh/sharing
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('language', newLang)
      window.history.replaceState(null, '', url.toString())
    }
  }, [])

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c)
    try { localStorage.setItem('rotmina-currency', c) } catch {}
  }, [])

  // Re-read the URL param on mount (resolveInitialLang may have run server-side
  // where window is undefined, so the ?language= param gets ignored on SSR).
  useEffect(() => {
    const urlParam = new URLSearchParams(window.location.search).get('language')
    if (urlParam === 'en' || urlParam === 'he') {
      setLang(urlParam)
    }
  }, [])

  // Update <html> dir and lang attributes when language changes
  useEffect(() => {
    const html = document.documentElement
    html.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr')
    html.setAttribute('lang', lang)
  }, [lang])

  const t = useCallback(
    (key: string) => getTranslation(key, lang),
    [lang]
  )

  const dir = lang === 'he' ? 'rtl' : 'ltr'

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, dir, currency, setCurrency }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
