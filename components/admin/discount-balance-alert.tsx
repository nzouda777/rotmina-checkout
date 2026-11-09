'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, Loader2, CheckCircle2, ExternalLink, Wrench } from 'lucide-react'
import { useAdmin } from '@/lib/admin-context'
import { useAdminLanguage } from '@/lib/admin-language-context'

interface Issue {
  sessionId: string
  orderId: string
  orderName: string
  customerName: string
  createdAt: string
  currency: string
  orderTotal: number
  outstanding: number
  missingDiscount: number
  codes: string[]
  fixable: boolean
}

const SHOP = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || 'rotmina-israel.myshopify.com'

/**
 * Paid orders that show a balance due in Shopify because their discount was
 * never sent to Shopify — with a one-click fix (adds the discount to the order).
 * Renders nothing when there is no such order.
 */
export function DiscountBalanceAlert() {
  const { apiFetch } = useAdmin()
  const { t, lang } = useAdminLanguage()

  const [issues, setIssues] = useState<Issue[]>([])
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({})

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/orders/discount-balance')
      const data = await res.json()
      if (res.ok) setIssues(data.issues || [])
    } catch { /* silent — this is a helper banner */ }
  }, [apiFetch])

  useEffect(() => { load() }, [load])

  const money = (n: number, currency: string) => {
    try { return new Intl.NumberFormat(lang === 'he' ? 'he-IL' : 'en-US', { style: 'currency', currency }).format(n) }
    catch { return `${n} ${currency}` }
  }

  const fix = async (issue: Issue) => {
    setConfirmId(null)
    setFixingId(issue.sessionId)
    try {
      const res = await apiFetch('/api/admin/orders/discount-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: issue.sessionId }),
      })
      const data = await res.json()
      setResults(r => ({
        ...r,
        [issue.sessionId]: res.ok && data.success
          ? { ok: true, text: t('orderBalance.fixed') }
          : { ok: false, text: `${t('orderBalance.fixFailed')}: ${data.error || res.status}` },
      }))
    } catch {
      setResults(r => ({ ...r, [issue.sessionId]: { ok: false, text: t('orderBalance.networkError') } }))
    } finally {
      setFixingId(null)
    }
  }

  const visible = issues.filter(i => !results[i.sessionId]?.ok)
  const done = issues.filter(i => results[i.sessionId]?.ok)
  if (visible.length === 0 && done.length === 0) return null

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      {visible.length > 0 && (
        <div className="flex gap-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">{t('orderBalance.title', { n: visible.length })}</p>
            <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">{t('orderBalance.desc')}</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {[...visible, ...done].map(issue => {
          const result = results[issue.sessionId]
          return (
            <div key={issue.sessionId} className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-white rounded-xl border border-amber-100 px-3 py-2.5 text-sm">
              <a
                href={`https://${SHOP}/admin/orders/${issue.orderId}`}
                target="_blank" rel="noreferrer"
                className="font-medium text-gray-900 hover:underline inline-flex items-center gap-1"
              >
                {issue.orderName} <ExternalLink className="h-3 w-3" />
              </a>
              <span className="text-gray-600">{issue.customerName}</span>
              <span className="text-xs text-gray-500">
                {t('orderBalance.line', {
                  total: money(issue.orderTotal, issue.currency),
                  due: money(issue.outstanding, issue.currency),
                  codes: issue.codes.join(', ') || '—',
                })}
              </span>

              <div className="ms-auto flex items-center gap-2">
                {result ? (
                  <span className={`text-xs inline-flex items-center gap-1 ${result.ok ? 'text-green-700' : 'text-red-600'}`}>
                    {result.ok && <CheckCircle2 className="h-3.5 w-3.5" />}{result.text}
                  </span>
                ) : !issue.fixable ? (
                  <span className="text-xs text-gray-500">{t('orderBalance.manual')}</span>
                ) : null}

                {issue.fixable && !result?.ok && (
                  confirmId === issue.sessionId ? (
                    <>
                      <button onClick={() => fix(issue)} className="text-xs px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-900">
                        {t('orderBalance.confirm', { amount: money(issue.outstanding, issue.currency) })}
                      </button>
                      <button onClick={() => setConfirmId(null)} className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
                        {t('orderBalance.cancel')}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmId(issue.sessionId)}
                      disabled={fixingId !== null}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-40"
                    >
                      {fixingId === issue.sessionId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                      {t('orderBalance.fix')}
                    </button>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
