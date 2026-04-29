'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { translations, type Language } from './translations'

interface LanguageContextType {
  lang: Language
  setLang: (lang: Language) => void
  t: (key: string) => string
  dir: 'ltr' | 'rtl'
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

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Default to Hebrew for Israeli audience
  const [lang, setLangState] = useState<Language>('he')

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang)
    // Persist preference
    if (typeof window !== 'undefined') {
      localStorage.setItem('rotmina-lang', newLang)
    }
  }, [])

  // Load saved preference on mount
  useEffect(() => {
    const saved = localStorage.getItem('rotmina-lang') as Language | null
    if (saved && (saved === 'en' || saved === 'he')) {
      setLangState(saved)
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
    <LanguageContext.Provider value={{ lang, setLang, t, dir }}>
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
