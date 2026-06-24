'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { type Language } from './translations'
import { createAdminT } from './admin-translations'

interface AdminLanguageContextType {
  lang: Language
  setLang: (lang: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
  dir: 'ltr' | 'rtl'
}

const AdminLanguageContext = createContext<AdminLanguageContextType | null>(null)

function resolveInitialLang(): Language {
  if (typeof window === 'undefined') return 'en'
  try {
    const saved = localStorage.getItem('rotmina-admin-lang')
    if (saved === 'en' || saved === 'he') return saved
  } catch {}
  return 'en'
}

export function AdminLanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(resolveInitialLang)

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang)
    try { localStorage.setItem('rotmina-admin-lang', newLang) } catch {}
  }, [])

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => createAdminT(lang)(key, params),
    [lang]
  )

  const dir = lang === 'he' ? 'rtl' : 'ltr'

  return (
    <AdminLanguageContext.Provider value={{ lang, setLang, t, dir }}>
      {children}
    </AdminLanguageContext.Provider>
  )
}

export function useAdminLanguage() {
  const ctx = useContext(AdminLanguageContext)
  if (!ctx) throw new Error('useAdminLanguage must be used within AdminLanguageProvider')
  return ctx
}
