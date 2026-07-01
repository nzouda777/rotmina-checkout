'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, ShoppingBag, Gift, LogOut,
  Menu, X, Eye, EyeOff, Loader2, ChevronRight, Ticket, Globe, Truck,
} from 'lucide-react'
import { AdminProvider, useAdmin } from '@/lib/admin-context'
import { AdminLanguageProvider, useAdminLanguage } from '@/lib/admin-language-context'

// ── Auth gate ─────────────────────────────────────────────────────────────────

function AuthGate() {
  const { login } = useAdmin()
  const { t } = useAdminLanguage()
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyInput.trim()) { setError(t('auth.keyRequired')); return }
    setIsLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { 'x-admin-key': keyInput.trim() },
      })
      if (res.status === 401) { setError(t('auth.invalidKey')); return }
      login(keyInput.trim())
    } catch {
      setError(t('auth.connectionError'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 w-full max-w-sm">
        <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-black mx-auto mb-5">
          <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-center text-gray-900 mb-1">Rotmina Admin</h1>
        <p className="text-sm text-center text-gray-500 mb-6">{t('auth.subtitle')}</p>

        <form onSubmit={handleLogin} className="space-y-3">
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => { setKeyInput(e.target.value); setError('') }}
              placeholder={t('auth.placeholder')}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 pr-10"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-black text-white text-sm font-medium hover:bg-gray-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isLoading ? t('auth.verifying') : t('auth.signIn')}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { logout } = useAdmin()
  const { t, lang, setLang } = useAdminLanguage()
  const pathname = usePathname()

  const NAV = [
    { href: '/admin/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { href: '/admin/orders',    label: t('nav.orders'),    icon: ShoppingBag },
    { href: '/admin/gift-cards',label: t('nav.giftCards'), icon: Gift },
    { href: '/admin/coupons',   label: t('nav.coupons'),   icon: Ticket },
    { href: '/admin/shipping',  label: t('nav.shipping'),  icon: Truck },
  ]

  return (
    <aside className="flex flex-col h-full bg-white border-r border-gray-200 w-64 flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-black flex items-center justify-center">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="font-semibold text-sm text-gray-900">{t('nav.adminTitle')}</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                active
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-gray-800' : 'text-gray-400'}`} />
              {label}
              {active && <ChevronRight className="h-3.5 w-3.5 ml-auto text-gray-400" />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-gray-100 space-y-1">
        {/* Language toggle */}
        <div className="flex items-center gap-2 px-3 py-2">
          <Globe className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <div className="flex gap-1">
            <button
              onClick={() => setLang('en')}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                lang === 'en'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLang('he')}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                lang === 'he'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              עב
            </button>
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          {t('nav.signOut')}
        </button>
      </div>
    </aside>
  )
}

// ── Admin shell ───────────────────────────────────────────────────────────────

function AdminShell({ children }: { children: React.ReactNode }) {
  const { isAuthed, authChecked } = useAdmin()
  const { dir } = useAdminLanguage()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" dir="ltr">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!isAuthed) return <AuthGate />

  return (
    <div className="flex min-h-screen bg-gray-50" dir={dir}>
      {/* Desktop sidebar — always fixed on the left regardless of language */}
      <div className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:w-64">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay — always slides from the left */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute top-0 bottom-0 left-0 w-64 bg-white shadow-xl">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content — always offset by the left sidebar */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center h-14 px-4 bg-white border-b border-gray-200 gap-3 sticky top-0 z-20">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold text-sm text-gray-900">Rotmina Admin</span>
        </div>

        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  )
}

// ── Root layout export ────────────────────────────────────────────────────────

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminLanguageProvider>
      <AdminProvider>
        <AdminShell>{children}</AdminShell>
      </AdminProvider>
    </AdminLanguageProvider>
  )
}
