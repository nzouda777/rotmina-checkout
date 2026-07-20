'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, ChevronLeft, ChevronRight, Loader2, X,
  User, MapPin, ShoppingBag, ExternalLink, RefreshCw,
} from 'lucide-react'
import { useAdmin } from '@/lib/admin-context'
import { useAdminLanguage } from '@/lib/admin-language-context'
import { getStateName } from '@/lib/states'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomerRow {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  address?: string
  city?: string
  country?: string
  province?: string
  postalCode?: string
  orderCount: number
  lastOrderAt: string
}

interface OrderRow {
  id: string
  status: string
  amount: number
  currency: string
  order_id: string | null
  shop: string
  created_at: string
}

const STATUS_STYLE: Record<string, { cls: string; dot: string }> = {
  paid:        { cls: 'text-green-700 bg-green-50 border-green-200',    dot: 'bg-green-500' },
  failed:      { cls: 'text-red-700 bg-red-50 border-red-200',          dot: 'bg-red-500' },
  pending:     { cls: 'text-amber-700 bg-amber-50 border-amber-200',    dot: 'bg-amber-400' },
  processing:  { cls: 'text-blue-700 bg-blue-50 border-blue-200',       dot: 'bg-blue-500' },
  pending_3ds: { cls: 'text-purple-700 bg-purple-50 border-purple-200', dot: 'bg-purple-500' },
  pending_bit: { cls: 'text-orange-700 bg-orange-50 border-orange-200', dot: 'bg-orange-400' },
  expired:     { cls: 'text-gray-500 bg-gray-50 border-gray-200',       dot: 'bg-gray-300' },
}

const LIMIT = 25

// ── Main component ────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const { apiFetch } = useAdmin()
  const { t } = useAdminLanguage()

  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearch = (v: string) => {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setDebouncedSearch(v); setPage(1) }, 400)
  }

  const [selectedEmail, setSelectedEmail] = useState<string | null>(null)
  const selectedCustomer = customers.find((c) => c.email === selectedEmail) || null
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)

  const fetchList = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    const params = new URLSearchParams({
      page: String(page),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    })
    try {
      const res = await apiFetch(`/api/admin/customers?${params}`)
      if (!res.ok) { setLoadError(t('customers.failedToLoad')); return }
      const data = await res.json()
      setCustomers(data.customers || [])
      setTotal(data.total || 0)
    } catch {
      setLoadError(t('customers.failedToLoad'))
    } finally {
      setIsLoading(false)
    }
  }, [apiFetch, page, debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchList() }, [fetchList])

  useEffect(() => {
    if (!selectedEmail) { setOrders([]); return }
    setOrdersLoading(true)
    apiFetch(`/api/admin/sessions?status=all&search=${encodeURIComponent(selectedEmail)}`)
      .then((r) => r.json())
      .then((data) => setOrders(data.sessions || []))
      .catch(() => setOrders([]))
      .finally(() => setOrdersLoading(false))
  }, [selectedEmail, apiFetch])

  const totalPages = Math.ceil(total / LIMIT)

  const fmt = (n: number, currency = 'ILS') =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="flex flex-col lg:flex-row min-h-full">
      {/* ── List panel ── */}
      <div className={`flex-1 min-w-0 flex flex-col ${selectedEmail ? 'lg:max-w-[60%]' : ''}`}>
        <div className="px-6 py-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{t('customers.title')}</h1>
              <p className="text-xs text-gray-400 mt-0.5">{t('customers.subtitle')}</p>
            </div>
            <button
              onClick={fetchList}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={t('customers.searchPlaceholder')}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
            />
          </div>

          <p className="text-xs text-gray-400">{t('customers.found', { count: total })}</p>
        </div>

        <div className="flex-1 overflow-x-auto">
          {loadError ? (
            <div className="p-8 text-center text-red-600 text-sm">{loadError}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-gray-100 bg-gray-50/50">
                  <Th>{t('customers.colCustomer')}</Th>
                  <Th>{t('customers.colPhone')}</Th>
                  <Th>{t('customers.colLocation')}</Th>
                  <Th>{t('customers.colOrders')}</Th>
                  <Th>{t('customers.colLastOrder')}</Th>
                </tr>
              </thead>
              <tbody>
                {isLoading && customers.length === 0 ? (
                  <tr><td colSpan={5} className="py-16 text-center">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-300 mx-auto" />
                  </td></tr>
                ) : customers.length === 0 ? (
                  <tr><td colSpan={5} className="py-16 text-center text-gray-400 text-sm">
                    {t('customers.noCustomersFound')}
                  </td></tr>
                ) : (
                  customers.map((c) => {
                    const isSelected = c.email === selectedEmail
                    const name = c.firstName ? `${c.firstName} ${c.lastName || ''}`.trim() : c.email.split('@')[0]
                    return (
                      <tr
                        key={c.email}
                        onClick={() => setSelectedEmail(isSelected ? null : c.email)}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${
                          isSelected ? 'bg-gray-100' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-4 py-3 max-w-40">
                          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                          <p className="text-xs text-gray-400 truncate">{c.email}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap" dir="ltr">
                          {c.phone || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 truncate max-w-32">
                          {[c.city, c.country].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {c.orderCount}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {fmtDate(c.lastOrderAt)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 mt-auto">
            <span className="text-xs text-gray-400">
              {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <PgBtn disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </PgBtn>
              <span className="px-3 text-sm text-gray-700">{page} / {totalPages}</span>
              <PgBtn disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </PgBtn>
            </div>
          </div>
        )}

        <div className="px-6 py-3 text-xs text-gray-300 border-t border-gray-50">
          {t('customers.coverageNote')}
        </div>
      </div>

      {/* ── Detail drawer ── */}
      {selectedEmail && selectedCustomer && (
        <div className="lg:w-[40%] lg:min-w-96 border-l border-gray-200 bg-white overflow-y-auto flex flex-col lg:sticky lg:top-0 lg:max-h-screen">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
            <span className="text-sm font-semibold text-gray-900">{t('customers.detailTitle')}</span>
            <button
              onClick={() => setSelectedEmail(null)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Saved info */}
          <Section icon={<User className="h-4 w-4" />} title={t('customers.sectionInfo')}>
            <dl className="space-y-1.5 text-sm">
              {(selectedCustomer.firstName || selectedCustomer.lastName) && (
                <Row label={t('customers.colName')} value={`${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim()} />
              )}
              <Row label={t('customers.colEmail')} value={selectedCustomer.email} />
              {selectedCustomer.phone && <Row label={t('customers.colPhone')} value={selectedCustomer.phone} />}
              <Row label={t('customers.colOrders')} value={t('customers.orderCount', { count: selectedCustomer.orderCount })} />
            </dl>
          </Section>

          {/* Address */}
          {selectedCustomer.address && (
            <Section icon={<MapPin className="h-4 w-4" />} title={t('customers.sectionAddress')}>
              <p className="text-sm text-gray-700 leading-relaxed">
                {selectedCustomer.address}
                {selectedCustomer.city && `, ${selectedCustomer.city}`}
                {selectedCustomer.province && `, ${getStateName(selectedCustomer.country || '', selectedCustomer.province)}`}
                {selectedCustomer.postalCode && ` ${selectedCustomer.postalCode}`}
                {selectedCustomer.country && `, ${selectedCustomer.country}`}
              </p>
            </Section>
          )}

          {/* Order history */}
          <Section icon={<ShoppingBag className="h-4 w-4" />} title={t('customers.sectionOrders')}>
            {ordersLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('customers.loadingOrders')}
              </div>
            ) : orders.length === 0 ? (
              <p className="text-xs text-gray-400">{t('customers.noCustomersFound')}</p>
            ) : (
              <div className="space-y-2">
                {orders.map((o) => {
                  const style = STATUS_STYLE[o.status] || STATUS_STYLE.pending
                  return (
                    <div key={o.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50 last:border-b-0">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500">{fmtDate(o.created_at)}</p>
                        {o.order_id && (
                          <a
                            href={`https://${o.shop}/admin/orders`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-mono"
                          >
                            #{o.order_id} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-medium text-gray-900">{fmt(o.amount, o.currency)}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${style.cls}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  )
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 space-y-3 border-b border-gray-100">
      <div className="flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-gray-400 flex-shrink-0">{label}</dt>
      <dd className="text-sm text-right break-all text-gray-700">{value}</dd>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  )
}

function PgBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}
