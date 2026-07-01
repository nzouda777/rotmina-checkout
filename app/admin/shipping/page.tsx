'use client'

import { useState, useEffect } from 'react'
import { Truck, Save, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import { useAdmin } from '@/lib/admin-context'
import { useAdminLanguage } from '@/lib/admin-language-context'

interface ShippingSettings {
  free_shipping_threshold_ils: number
  domestic_shipping_fee_ils: number
  international_shipping_pct: number
  updated_at?: string
}

export default function ShippingSettingsPage() {
  const { apiFetch } = useAdmin()
  const { t } = useAdminLanguage()

  const [settings, setSettings] = useState<ShippingSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [threshold, setThreshold] = useState('')
  const [fee, setFee] = useState('')
  const [pct, setPct] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState('')

  const load = async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const res = await apiFetch('/api/admin/shipping-settings')
      const data = await res.json()
      if (!res.ok) { setLoadError(data.error || t('shipping.failedToLoad')); return }
      const s: ShippingSettings = data.settings
      setSettings(s)
      setThreshold(String(s.free_shipping_threshold_ils))
      setFee(String(s.domestic_shipping_fee_ils))
      setPct(String(s.international_shipping_pct))
    } catch {
      setLoadError(t('shipping.networkError'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaveError('')
    setSaveSuccess(false)

    const t_val = Number(threshold)
    const f_val = Number(fee)
    const p_val = Number(pct)

    if (isNaN(t_val) || t_val < 0) { setSaveError(t('shipping.errorThreshold')); return }
    if (isNaN(f_val) || f_val < 0) { setSaveError(t('shipping.errorFee')); return }
    if (isNaN(p_val) || p_val < 0 || p_val > 100) { setSaveError(t('shipping.errorPct')); return }

    setIsSaving(true)
    try {
      const res = await apiFetch('/api/admin/shipping-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          free_shipping_threshold_ils: t_val,
          domestic_shipping_fee_ils: f_val,
          international_shipping_pct: p_val,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveError(data.error || t('shipping.errorSave')); return }
      setSettings(data.settings)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch {
      setSaveError(t('shipping.networkError'))
    } finally {
      setIsSaving(false)
    }
  }

  const formatDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
            <Truck className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{t('shipping.title')}</h1>
            {settings?.updated_at && (
              <p className="text-xs text-gray-400">{t('shipping.lastUpdated', { time: formatDate(settings.updated_at) })}</p>
            )}
          </div>
        </div>
        <button
          onClick={load}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {t('shipping.refresh')}
        </button>
      </div>

      {/* Load error */}
      {loadError && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {loadError}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && !settings && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-40 bg-gray-100 rounded animate-pulse" />
              <div className="h-10 w-full bg-gray-100 rounded-xl animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* Form */}
      {!isLoading && settings && (
        <form onSubmit={handleSave} className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
          {/* ILS section */}
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('shipping.sectionIls')}</span>
            </div>

            {/* Free shipping threshold */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                {t('shipping.thresholdLabel')}
              </label>
              <p className="text-xs text-gray-400">{t('shipping.thresholdDesc')}</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">₪</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-full pl-7 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                />
              </div>
            </div>

            {/* Domestic flat fee */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                {t('shipping.feeLabel')}
              </label>
              <p className="text-xs text-gray-400">{t('shipping.feeDesc')}</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">₪</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  className="w-full pl-7 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                />
              </div>
            </div>
          </div>

          {/* USD section */}
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('shipping.sectionUsd')}</span>
            </div>

            {/* International percentage */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                {t('shipping.pctLabel')}
              </label>
              <p className="text-xs text-gray-400">{t('shipping.pctDesc')}</p>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={pct}
                  onChange={(e) => setPct(e.target.value)}
                  className="w-full pl-4 pr-8 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">%</span>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="p-6 flex items-center justify-between gap-4">
            <div className="flex-1">
              {saveError && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {saveError}
                </div>
              )}
              {saveSuccess && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  {t('shipping.saveSuccess')}
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2.5 bg-black text-white text-sm font-medium rounded-xl hover:bg-gray-900 transition-colors disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? t('shipping.saving') : t('shipping.save')}
            </button>
          </div>
        </form>
      )}

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 space-y-1.5">
        <p className="font-semibold">{t('shipping.infoTitle')}</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>{t('shipping.infoFreeGiftCard')}</li>
          <li>{t('shipping.infoIlsFree')}</li>
          <li>{t('shipping.infoIlsFee')}</li>
          <li>{t('shipping.infoUsd')}</li>
        </ul>
      </div>
    </div>
  )
}
