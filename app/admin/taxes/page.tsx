'use client'

import { useState, useEffect } from 'react'
import {
  ReceiptText, Plus, Save, Loader2, CheckCircle2, AlertCircle, RefreshCw,
  Pencil, Trash2, X, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { useAdmin } from '@/lib/admin-context'
import { useAdminLanguage } from '@/lib/admin-language-context'

interface TaxRule {
  id: number
  country: string
  tax_rate: number
  enabled: boolean
  updated_at?: string
}

const COUNTRY_SUGGESTIONS = [
  'United States', 'United Kingdom', 'Europe', 'Canada', 'Switzerland',
  'Australia', 'France', 'Germany', 'Japan', 'Singapore',
]

export default function TaxRulesPage() {
  const { apiFetch } = useAdmin()
  const { t } = useAdminLanguage()

  const [rules, setRules] = useState<TaxRule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [newCountry, setNewCountry] = useState('')
  const [newRate, setNewRate] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Edit state
  const [editId, setEditId] = useState<number | null>(null)
  const [editCountry, setEditCountry] = useState('')
  const [editRate, setEditRate] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')
  const [editSuccess, setEditSuccess] = useState<number | null>(null)

  // Delete state
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // Toggle state
  const [togglingId, setTogglingId] = useState<number | null>(null)

  const load = async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const res = await apiFetch('/api/admin/tax-rules')
      const data = await res.json()
      if (!res.ok) { setLoadError(data.error || t('taxes.failedToLoad')); return }
      setRules(data.rules || [])
    } catch {
      setLoadError(t('taxes.networkError'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    const country = newCountry.trim()
    const rate = Number(newRate)
    if (!country) { setCreateError(t('taxes.errorCountry')); return }
    if (isNaN(rate) || rate < 0 || rate > 100) { setCreateError(t('taxes.errorRate')); return }

    setIsCreating(true)
    try {
      const res = await apiFetch('/api/admin/tax-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country, tax_rate: rate, enabled: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(res.status === 409 ? t('taxes.errorDuplicate') : (data.error || t('taxes.errorCreate')))
        return
      }
      setRules((prev) => [...prev, data.rule].sort((a, b) => a.country.localeCompare(b.country)))
      setNewCountry('')
      setNewRate('')
      setShowCreate(false)
    } catch {
      setCreateError(t('taxes.networkError'))
    } finally {
      setIsCreating(false)
    }
  }

  const startEdit = (rule: TaxRule) => {
    setEditId(rule.id)
    setEditCountry(rule.country)
    setEditRate(String(rule.tax_rate))
    setEditError('')
    setEditSuccess(null)
  }

  const cancelEdit = () => {
    setEditId(null)
    setEditError('')
  }

  const handleSaveEdit = async (id: number) => {
    setEditError('')
    const country = editCountry.trim()
    const rate = Number(editRate)
    if (!country) { setEditError(t('taxes.errorCountry')); return }
    if (isNaN(rate) || rate < 0 || rate > 100) { setEditError(t('taxes.errorRate')); return }

    setIsSavingEdit(true)
    try {
      const res = await apiFetch(`/api/admin/tax-rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country, tax_rate: rate }),
      })
      const data = await res.json()
      if (!res.ok) { setEditError(data.error || t('taxes.errorUpdate')); return }
      setRules((prev) => prev.map((r) => (r.id === id ? data.rule : r)).sort((a, b) => a.country.localeCompare(b.country)))
      setEditId(null)
      setEditSuccess(id)
      setTimeout(() => setEditSuccess(null), 2000)
    } catch {
      setEditError(t('taxes.networkError'))
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleToggle = async (rule: TaxRule) => {
    setTogglingId(rule.id)
    try {
      const res = await apiFetch(`/api/admin/tax-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      const data = await res.json()
      if (res.ok) {
        setRules((prev) => prev.map((r) => (r.id === rule.id ? data.rule : r)))
      }
    } catch {
      // silent
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm(t('taxes.deleteConfirm'))) return
    setDeletingId(id)
    try {
      const res = await apiFetch(`/api/admin/tax-rules/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== id))
      }
    } catch {
      // silent
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
            <ReceiptText className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{t('taxes.title')}</h1>
            <p className="text-xs text-gray-400">{t('taxes.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            {t('taxes.refresh')}
          </button>
          <button
            onClick={() => { setShowCreate(true); setCreateError('') }}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-gray-900 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('taxes.addRule')}
          </button>
        </div>
      </div>

      {/* Load error */}
      {loadError && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {loadError}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">{t('taxes.addTitle')}</span>
            <button type="button" onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">{t('taxes.countryLabel')}</label>
              <input
                list="country-suggestions"
                value={newCountry}
                onChange={(e) => setNewCountry(e.target.value)}
                placeholder="e.g. United States"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
              />
              <datalist id="country-suggestions">
                {COUNTRY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">{t('taxes.rateLabel')}</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={newRate}
                  onChange={(e) => setNewRate(e.target.value)}
                  placeholder="0"
                  className="w-full pl-3 pr-8 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
              </div>
            </div>
          </div>
          {createError && (
            <p className="text-sm text-red-600 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {createError}
            </p>
          )}
          <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-50 transition-colors">
              {t('taxes.cancel')}
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-gray-900 transition-colors disabled:opacity-50"
            >
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t('taxes.save')}
            </button>
          </div>
        </form>
      )}

      {/* Rules table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {isLoading && !rules.length ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('taxes.noRules')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('taxes.colCountry')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('taxes.colRate')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('taxes.colStatus')}</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">{t('taxes.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-gray-50/50 transition-colors">
                  {editId === rule.id ? (
                    /* Edit row */
                    <td colSpan={4} className="px-5 py-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 grid grid-cols-2 gap-3">
                          <input
                            value={editCountry}
                            onChange={(e) => setEditCountry(e.target.value)}
                            className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                          />
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.5"
                              value={editRate}
                              onChange={(e) => setEditRate(e.target.value)}
                              className="w-full pl-3 pr-8 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <button
                            onClick={() => handleSaveEdit(rule.id)}
                            disabled={isSavingEdit}
                            className="flex items-center gap-1.5 px-3 py-2 bg-black text-white text-xs font-medium rounded-xl hover:bg-gray-900 disabled:opacity-50"
                          >
                            {isSavingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            {t('taxes.save')}
                          </button>
                          <button onClick={cancelEdit} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {editError && (
                        <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" /> {editError}
                        </p>
                      )}
                    </td>
                  ) : (
                    <>
                      <td className="px-5 py-3.5 font-medium text-gray-800">{rule.country}</td>
                      <td className="px-5 py-3.5 text-gray-600">
                        {rule.tax_rate === 0 ? (
                          <span className="text-gray-400">0% (no tax)</span>
                        ) : (
                          <span className="font-medium text-gray-900">{rule.tax_rate}%</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {editSuccess === rule.id ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" /> {t('taxes.saveSuccess')}
                          </span>
                        ) : (
                          <button
                            onClick={() => handleToggle(rule)}
                            disabled={togglingId === rule.id}
                            className="flex items-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            {togglingId === rule.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                            ) : rule.enabled ? (
                              <ToggleRight className="h-5 w-5 text-green-600" />
                            ) : (
                              <ToggleLeft className="h-5 w-5 text-gray-400" />
                            )}
                            <span className={rule.enabled ? 'text-green-700' : 'text-gray-400'}>
                              {rule.enabled ? t('taxes.enabled') : t('taxes.disabled')}
                            </span>
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => startEdit(rule)}
                            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                            title={t('taxes.editTitle')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(rule.id)}
                            disabled={deletingId === rule.id}
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                            title={t('taxes.delete')}
                          >
                            {deletingId === rule.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 space-y-1.5">
        <p className="font-semibold">{t('taxes.infoTitle')}</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>{t('taxes.infoLine1')}</li>
          <li>{t('taxes.infoLine2')}</li>
          <li>{t('taxes.infoLine3')}</li>
          <li>{t('taxes.infoLine4')}</li>
        </ul>
      </div>
    </div>
  )
}
