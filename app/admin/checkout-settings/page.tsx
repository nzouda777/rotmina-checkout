'use client'

import { useState, useEffect } from 'react'
import { SlidersHorizontal, RefreshCw, AlertCircle, CheckCircle2, Loader2, ToggleLeft, ToggleRight, ShieldAlert } from 'lucide-react'
import { useAdmin } from '@/lib/admin-context'
import { useAdminLanguage } from '@/lib/admin-language-context'

interface CheckoutSettings {
  returning_customer_autofill_enabled: boolean
}

export default function CheckoutSettingsPage() {
  const { apiFetch } = useAdmin()
  const { t } = useAdminLanguage()

  const [settings, setSettings] = useState<CheckoutSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [isToggling, setIsToggling] = useState(false)
  const [toggleError, setToggleError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  const load = async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const res = await apiFetch('/api/admin/checkout-settings')
      const data = await res.json()
      if (!res.ok) { setLoadError(data.error || t('checkoutSettings.failedToLoad')); return }
      setSettings(data.settings)
    } catch {
      setLoadError(t('checkoutSettings.networkError'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = async () => {
    if (!settings) return
    setIsToggling(true)
    setToggleError('')
    try {
      const res = await apiFetch('/api/admin/checkout-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returning_customer_autofill_enabled: !settings.returning_customer_autofill_enabled }),
      })
      const data = await res.json()
      if (!res.ok) { setToggleError(data.error || t('checkoutSettings.errorSave')); return }
      setSettings(data.settings)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch {
      setToggleError(t('checkoutSettings.networkError'))
    } finally {
      setIsToggling(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
            <SlidersHorizontal className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{t('checkoutSettings.title')}</h1>
            <p className="text-xs text-gray-400">{t('checkoutSettings.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {t('checkoutSettings.refresh')}
        </button>
      </div>

      {/* Load error */}
      {loadError && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {loadError}
        </div>
      )}

      {/* Settings card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        {isLoading && !settings ? (
          <div className="h-16 bg-gray-100 rounded-xl animate-pulse" />
        ) : settings ? (
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-gray-800">{t('checkoutSettings.autofillTitle')}</p>
              <p className="text-xs text-gray-500 leading-relaxed max-w-md">{t('checkoutSettings.autofillDesc')}</p>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              {saveSuccess ? (
                <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t('checkoutSettings.saveSuccess')}
                </span>
              ) : (
                <button
                  onClick={handleToggle}
                  disabled={isToggling}
                  className="flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {isToggling ? (
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  ) : settings.returning_customer_autofill_enabled ? (
                    <ToggleRight className="h-6 w-6 text-green-600" />
                  ) : (
                    <ToggleLeft className="h-6 w-6 text-gray-400" />
                  )}
                  <span className={settings.returning_customer_autofill_enabled ? 'text-green-700' : 'text-gray-400'}>
                    {settings.returning_customer_autofill_enabled ? t('checkoutSettings.enabled') : t('checkoutSettings.disabled')}
                  </span>
                </button>
              )}
              {toggleError && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> {toggleError}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Privacy note */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-800 flex gap-2.5">
        <ShieldAlert className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">{t('checkoutSettings.privacyNoteTitle')}</p>
          <p className="leading-relaxed">{t('checkoutSettings.privacyNote')}</p>
        </div>
      </div>
    </div>
  )
}
