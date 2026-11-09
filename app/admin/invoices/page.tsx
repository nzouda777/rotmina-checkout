'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FileText, RefreshCw, Search, Loader2, AlertCircle, AlertTriangle,
  CheckCircle2, XCircle, Clock, Send, ExternalLink, ChevronLeft, ChevronRight, Database,
} from 'lucide-react'
import { useAdmin } from '@/lib/admin-context'
import { useAdminLanguage } from '@/lib/admin-language-context'

// ── Types ─────────────────────────────────────────────────────────────────────

type Filter = 'failed' | 'untracked' | 'sent' | 'all'
type RowStatus = 'sent' | 'failed' | 'sending' | 'stuck' | null

interface ReceiptRow {
  id: string
  shop: string
  amount: number
  currency: string
  order_id: string | null
  created_at: string
  customer?: { email?: string; firstName?: string; lastName?: string }
  cart?: { total?: number; currency?: string; language?: string }
  morning_status: RowStatus
  morning_document_id: string | null
  morning_document_url: string | null
  morning_error: string | null
  morning_attempts: number
  morning_last_attempt_at: string | null
  is_test?: boolean
}

interface RowFeedback { ok: boolean; message: string }

const STATUS_STYLE: Record<string, { cls: string; icon: React.ReactNode; key: string }> = {
  sent:      { cls: 'text-green-700 bg-green-50 border-green-200',  icon: <CheckCircle2 className="h-3.5 w-3.5" />, key: 'invoices.statusSent' },
  failed:    { cls: 'text-red-700 bg-red-50 border-red-200',        icon: <XCircle className="h-3.5 w-3.5" />,      key: 'invoices.statusFailed' },
  stuck:     { cls: 'text-red-700 bg-red-50 border-red-200',        icon: <AlertTriangle className="h-3.5 w-3.5" />, key: 'invoices.statusStuck' },
  sending:   { cls: 'text-blue-700 bg-blue-50 border-blue-200',     icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, key: 'invoices.statusSending' },
  untracked: { cls: 'text-gray-600 bg-gray-50 border-gray-200',     icon: <Clock className="h-3.5 w-3.5" />,        key: 'invoices.statusUntracked' },
}

function formatAmount(value: number, currency: string, lang: string) {
  try {
    return new Intl.NumberFormat(lang === 'he' ? 'he-IL' : 'en-US', { style: 'currency', currency }).format(value)
  } catch {
    return `${value} ${currency}`
  }
}

function formatDate(iso: string, lang: string) {
  return new Date(iso).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** Morning errors come back as "Morning API error (400): {json}" — show the readable part. */
function readableError(raw: string | null) {
  if (!raw) return ''
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      const msg = parsed.errorMessage || parsed.message || parsed.error
      if (msg) return `${raw.slice(0, raw.indexOf('{')).trim()} ${parsed.errorCode ? `[${parsed.errorCode}] ` : ''}${msg}`
    } catch { /* keep raw */ }
  }
  return raw
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const { apiFetch } = useAdmin()
  const { t, lang } = useAdminLanguage()

  const [filter, setFilter] = useState<Filter>('failed')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(25)
  const [counts, setCounts] = useState({ failed: 0, untracked: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [migrationRequired, setMigrationRequired] = useState(false)

  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, RowFeedback>>({})

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const qs = new URLSearchParams({ filter, page: String(page) })
      if (search) qs.set('search', search)
      const res = await apiFetch(`/api/admin/morning-receipts?${qs}`)
      const data = await res.json()
      if (data.migrationRequired) { setMigrationRequired(true); setRows([]); return }
      if (!res.ok) { setLoadError(data.error || t('invoices.failedToLoad')); return }
      setMigrationRequired(false)
      setRows(data.sessions || [])
      setTotal(data.total || 0)
      setLimit(data.limit || 25)
      setCounts(data.counts || { failed: 0, untracked: 0 })
    } catch {
      setLoadError(t('invoices.networkError'))
    } finally {
      setIsLoading(false)
    }
  }, [apiFetch, filter, page, search, t])

  useEffect(() => { load() }, [load])

  // Debounced search
  useEffect(() => {
    const id = setTimeout(() => { setPage(1); setSearch(searchInput.trim()) }, 400)
    return () => clearTimeout(id)
  }, [searchInput])

  /** One resend; returns true on success. Does not reload the list. */
  const resendOne = async (row: ReceiptRow): Promise<boolean> => {
    setSendingId(row.id)
    setFeedback(f => { const n = { ...f }; delete n[row.id]; return n })
    try {
      const res = await apiFetch('/api/admin/morning-receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: row.id }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setFeedback(f => ({ ...f, [row.id]: { ok: true, message: t('invoices.resendSuccess') } }))
        return true
      }
      setFeedback(f => ({ ...f, [row.id]: { ok: false, message: `${t('invoices.resendFailed')}: ${readableError(data.error || '')}` } }))
      return false
    } catch {
      setFeedback(f => ({ ...f, [row.id]: { ok: false, message: t('invoices.networkError') } }))
      return false
    } finally {
      setSendingId(null)
    }
  }

  const resend = async (row: ReceiptRow) => {
    setConfirmId(null)
    await resendOne(row)
    load()
  }

  // ── Bulk resend (Failed tab, visible page, test cards excluded) ──────────────
  const bulkRows = filter === 'failed' ? rows.filter(r => !r.is_test && r.morning_status !== 'sending') : []
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; n: number } | null>(null)
  const [bulkResult, setBulkResult] = useState('')

  const resendAll = async () => {
    setBulkConfirm(false)
    setBulkResult('')
    const queue = [...bulkRows]
    let ok = 0
    setBulkProgress({ done: 0, n: queue.length })
    // Sequential on purpose: Morning numbers documents in order, and a burst
    // of parallel requests is the easiest way to get rate-limited.
    for (let i = 0; i < queue.length; i++) {
      if (await resendOne(queue[i])) ok++
      setBulkProgress({ done: i + 1, n: queue.length })
    }
    setBulkProgress(null)
    setBulkResult(t('invoices.resendAllDone', { ok, failed: queue.length - ok }))
    load()
  }

  // ── Reconciliation with Morning ──────────────────────────────────────────────
  const [since, setSince] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().slice(0, 10)
  })
  const [isReconciling, setIsReconciling] = useState(false)
  const [reconcileMsg, setReconcileMsg] = useState<RowFeedback | null>(null)

  const reconcile = async () => {
    setIsReconciling(true)
    setReconcileMsg(null)
    try {
      const res = await apiFetch('/api/admin/morning-receipts/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since }),
      })
      const data = await res.json()
      if (data.migrationRequired) { setMigrationRequired(true); return }
      if (!res.ok) { setReconcileMsg({ ok: false, message: `${t('invoices.reconcileFailed')}: ${data.error || res.status}` }); return }
      setReconcileMsg({
        ok: data.missing.length === 0,
        message: t('invoices.reconcileResult', { checked: data.checked, found: data.found, missing: data.missing.length }),
      })
      setPage(1)
      if (filter !== 'failed') setFilter('failed')
      else load()
    } catch {
      setReconcileMsg({ ok: false, message: t('invoices.networkError') })
    } finally {
      setIsReconciling(false)
    }
  }

  const pages = Math.max(1, Math.ceil(total / limit))

  const TABS: { key: Filter; label: string; count?: number }[] = [
    { key: 'failed',    label: t('invoices.tabFailed'),    count: counts.failed },
    { key: 'untracked', label: t('invoices.tabUntracked'), count: counts.untracked },
    { key: 'sent',      label: t('invoices.tabSent') },
    { key: 'all',       label: t('invoices.tabAll') },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
            <FileText className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{t('invoices.title')}</h1>
            <p className="text-xs text-gray-400">{t('invoices.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {t('invoices.refresh')}
        </button>
      </div>

      {migrationRequired && (
        <div className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <Database className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{t('invoices.migrationTitle')}</p>
            <p className="text-xs mt-1">{t('invoices.migrationBody')}</p>
          </div>
        </div>
      )}

      {/* Reconciliation with Morning */}
      {!migrationRequired && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{t('invoices.reconcileTitle')}</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t('invoices.reconcileDesc')}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-500 space-y-1">
              <span className="block">{t('invoices.reconcileSince')}</span>
              <input
                type="date"
                value={since}
                max={new Date().toISOString().slice(0, 10)}
                onChange={e => setSince(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900"
              />
            </label>
            <button
              onClick={reconcile}
              disabled={isReconciling || !since}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-900 disabled:opacity-50"
            >
              {isReconciling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {isReconciling ? t('invoices.reconcileRunning') : t('invoices.reconcileBtn')}
            </button>
          </div>
          {reconcileMsg && (
            <p className={`text-xs ${reconcileMsg.ok ? 'text-green-700' : 'text-amber-700'}`}>{reconcileMsg.message}</p>
          )}
        </div>
      )}

      {/* Tabs + search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setFilter(tab.key); setPage(1); setConfirmId(null) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                filter === tab.key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`text-[11px] px-1.5 rounded-full ${
                  filter === tab.key ? 'bg-white/20' : tab.key === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={t('invoices.searchPlaceholder')}
            className="w-full ps-9 pe-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
          />
        </div>
      </div>

      {loadError && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {loadError}
        </div>
      )}

      {/* Bulk resend */}
      {(bulkRows.length > 0 || bulkProgress || bulkResult) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {bulkResult && <span className="text-xs text-gray-600 me-auto">{bulkResult}</span>}
          {bulkProgress ? (
            <span className="flex items-center gap-1.5 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('invoices.resendAllProgress', { done: bulkProgress.done, n: bulkProgress.n })}
            </span>
          ) : bulkConfirm ? (
            <>
              <span className="text-sm text-gray-700">{t('invoices.resendAllConfirm', { n: bulkRows.length })}</span>
              <button onClick={resendAll} className="text-sm px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-900">
                {t('invoices.confirmResend')}
              </button>
              <button onClick={() => setBulkConfirm(false)} className="text-sm px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
                {t('invoices.cancel')}
              </button>
            </>
          ) : bulkRows.length > 0 && (
            <button
              onClick={() => setBulkConfirm(true)}
              disabled={sendingId !== null}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
              {t('invoices.resendAll', { n: bulkRows.length })}
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100 text-start">
                <th className="px-4 py-3 font-medium text-start">{t('invoices.colDate')}</th>
                <th className="px-4 py-3 font-medium text-start">{t('invoices.colCustomer')}</th>
                <th className="px-4 py-3 font-medium text-start">{t('invoices.colAmount')}</th>
                <th className="px-4 py-3 font-medium text-start">{t('invoices.colOrder')}</th>
                <th className="px-4 py-3 font-medium text-start">{t('invoices.colStatus')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center"><Loader2 className="h-5 w-5 animate-spin text-gray-300 mx-auto" /></td></tr>
              )}
              {!isLoading && rows.length === 0 && !migrationRequired && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">
                  {filter === 'failed' && !search ? t('invoices.emptyFailed') : t('invoices.empty')}
                </td></tr>
              )}
              {rows.map(row => {
                const statusKey = row.morning_status || 'untracked'
                const style = STATUS_STYLE[statusKey] || STATUS_STYLE.untracked
                const canResend = !row.is_test && row.morning_status !== 'sent' && row.morning_status !== 'sending' && !bulkProgress
                const currency = row.cart?.currency || row.currency || 'ILS'
                const amount = Number(row.cart?.total ?? row.amount ?? 0)
                const fb = feedback[row.id]
                const name = `${row.customer?.firstName || ''} ${row.customer?.lastName || ''}`.trim()
                return (
                  <tr key={row.id} className="border-b border-gray-50 last:border-0 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(row.created_at, lang)}</td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{name || '—'}</p>
                      <p className="text-xs text-gray-400">{row.customer?.email || '—'}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-900">{formatAmount(amount, currency, lang)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {row.order_id ? (
                        <a
                          href={`https://${row.shop}/admin/orders/${row.order_id}`}
                          target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-gray-700 hover:text-black hover:underline"
                        >
                          {row.order_id} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${style.cls}`}>
                        {style.icon}{t(style.key)}
                      </span>
                      {row.is_test && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 ms-2">{t('invoices.testBadge')}</span>
                      )}
                      {row.morning_attempts > 0 && (
                        <span className="text-[11px] text-gray-400 ms-2">{t('invoices.attempts', { n: row.morning_attempts })}</span>
                      )}
                      {row.morning_error && row.morning_status !== 'sent' && (
                        <p className="text-xs text-red-600 mt-1 break-words">{readableError(row.morning_error)}</p>
                      )}
                      {fb && (
                        <p className={`text-xs mt-1 ${fb.ok ? 'text-green-600' : 'text-red-600'}`}>{fb.message}</p>
                      )}
                      {confirmId === row.id && row.morning_status === null && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 mt-2">
                          {t('invoices.untrackedWarning')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end whitespace-nowrap">
                      {row.morning_status === 'sent' && row.morning_document_url && /^https?:\/\//.test(row.morning_document_url) && (
                        <a
                          href={row.morning_document_url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"
                        >
                          {t('invoices.viewDoc')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {canResend && (
                        confirmId === row.id ? (
                          <div className="inline-flex gap-1">
                            <button
                              onClick={() => resend(row)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-900"
                            >
                              {t('invoices.confirmResend')}
                            </button>
                            <button
                              onClick={() => setConfirmId(null)}
                              className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
                            >
                              {t('invoices.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmId(row.id)}
                            disabled={sendingId !== null}
                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                          >
                            {sendingId === row.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Send className="h-3.5 w-3.5" />}
                            {t('invoices.resend')}
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
            <span>{t('invoices.pageOf', { page, pages })}</span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(pages, p + 1))}
                disabled={page >= pages || isLoading}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
