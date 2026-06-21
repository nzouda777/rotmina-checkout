'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, ChevronLeft, ChevronRight, Loader2, X,
  Package, CreditCard, User, MapPin, ExternalLink,
  RefreshCw, ChevronDown, ChevronUp, Copy, CheckCircle2, Gift,
} from 'lucide-react'
import { useAdmin } from '@/lib/admin-context'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string
  shop: string
  status: string
  amount: number
  currency: string
  order_id: string | null
  tranzila_transaction_id: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  customer?: {
    email?: string; firstName?: string; lastName?: string
    address?: string; city?: string; country?: string; phone?: string
  }
  cart?: {
    items?: { title: string; quantity: number; price: number; variant?: string; image?: string }[]
    subtotal?: number; shipping?: number; tax?: number; total?: number; currency?: string
  }
}

interface SessionDetail extends SessionRow {
  raw_response: Record<string, unknown> | null
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  paid:        { label: 'Paid',       cls: 'text-green-700 bg-green-50 border-green-200',   dot: 'bg-green-500' },
  failed:      { label: 'Failed',     cls: 'text-red-700 bg-red-50 border-red-200',         dot: 'bg-red-500' },
  pending:     { label: 'Pending',    cls: 'text-amber-700 bg-amber-50 border-amber-200',   dot: 'bg-amber-400' },
  processing:  { label: 'Processing', cls: 'text-blue-700 bg-blue-50 border-blue-200',      dot: 'bg-blue-500' },
  pending_3ds: { label: '3DS',        cls: 'text-purple-700 bg-purple-50 border-purple-200', dot: 'bg-purple-500' },
  pending_bit: { label: 'Bit',        cls: 'text-orange-700 bg-orange-50 border-orange-200', dot: 'bg-orange-400' },
  expired:     { label: 'Expired',    cls: 'text-gray-500 bg-gray-50 border-gray-200',      dot: 'bg-gray-300' },
}

const ALL_STATUSES = ['paid', 'failed', 'pending', 'processing', 'pending_3ds', 'pending_bit', 'expired']

const DATE_PRESETS = [
  { label: 'All time', from: '', to: '' },
  { label: 'Today', from: () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString() }, to: '' },
  { label: 'This week', from: () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d.toISOString() }, to: '' },
  { label: 'This month', from: () => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.toISOString() }, to: '' },
]

const LIMIT = 25

// ── Main component ────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const { apiFetch } = useAdmin()

  // List state
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  // Filters
  const [statusFilter, setStatusFilter] = useState('all')
  const [datePreset, setDatePreset] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearch = (v: string) => {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setDebouncedSearch(v); setPage(1) }, 400)
  }

  // Detail drawer
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ session: SessionDetail; giftCard: unknown } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Fetch list
  const fetchList = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    const preset = DATE_PRESETS[datePreset]
    const from = typeof preset.from === 'function' ? preset.from() : preset.from
    const params = new URLSearchParams({
      page: String(page),
      status: statusFilter,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(from ? { from } : {}),
    })
    try {
      const res = await apiFetch(`/api/admin/sessions?${params}`)
      if (!res.ok) { setLoadError('Failed to load'); return }
      const data = await res.json()
      setSessions(data.sessions || [])
      setTotal(data.total || 0)
    } catch {
      setLoadError('Network error')
    } finally {
      setIsLoading(false)
    }
  }, [apiFetch, page, statusFilter, datePreset, debouncedSearch])

  useEffect(() => { fetchList() }, [fetchList])

  // Fetch detail
  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    setDetailLoading(true)
    setRawOpen(false)
    apiFetch(`/api/admin/sessions/${selectedId}`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false))
  }, [selectedId, apiFetch])

  const totalPages = Math.ceil(total / LIMIT)

  const fmt = (n: number, currency = 'ILS') =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-full">
      {/* ── List panel ── */}
      <div className={`flex-1 min-w-0 flex flex-col ${selectedId ? 'lg:max-w-[60%]' : ''}`}>
        <div className="px-6 py-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-gray-900">Orders</h1>
            <button
              onClick={fetchList}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Filters */}
          <div className="space-y-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search by email or session ID…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>

            {/* Status + date row */}
            <div className="flex gap-2 flex-wrap">
              {/* Status tabs */}
              <div className="flex bg-gray-100 rounded-xl p-1 gap-0.5 flex-wrap">
                <FilterTab active={statusFilter === 'all'} onClick={() => { setStatusFilter('all'); setPage(1) }}>
                  All
                </FilterTab>
                {ALL_STATUSES.map((s) => (
                  <FilterTab key={s} active={statusFilter === s} onClick={() => { setStatusFilter(s); setPage(1) }}>
                    {STATUS[s]?.label || s}
                  </FilterTab>
                ))}
              </div>

              {/* Date presets */}
              <div className="flex bg-gray-100 rounded-xl p-1 gap-0.5">
                {DATE_PRESETS.map((p, i) => (
                  <FilterTab key={i} active={datePreset === i} onClick={() => { setDatePreset(i); setPage(1) }}>
                    {p.label}
                  </FilterTab>
                ))}
              </div>
            </div>
          </div>

          {/* Count */}
          <p className="text-xs text-gray-400">{total} orders found</p>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-x-auto">
          {loadError ? (
            <div className="p-8 text-center text-red-600 text-sm">{loadError}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-gray-100 bg-gray-50/50">
                  <Th>Date</Th>
                  <Th>Customer</Th>
                  <Th>Amount</Th>
                  <Th>Status</Th>
                  <Th>Order</Th>
                </tr>
              </thead>
              <tbody>
                {isLoading && sessions.length === 0 ? (
                  <tr><td colSpan={5} className="py-16 text-center">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-300 mx-auto" />
                  </td></tr>
                ) : sessions.length === 0 ? (
                  <tr><td colSpan={5} className="py-16 text-center text-gray-400 text-sm">
                    No orders found
                  </td></tr>
                ) : (
                  sessions.map((s) => {
                    const meta = STATUS[s.status] || STATUS.pending
                    const isSelected = s.id === selectedId
                    const name = s.customer?.firstName
                      ? `${s.customer.firstName} ${s.customer.lastName || ''}`.trim()
                      : s.customer?.email?.split('@')[0] || '—'
                    const email = s.customer?.email || ''
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedId(isSelected ? null : s.id)}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${
                          isSelected ? 'bg-gray-100' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {fmtDate(s.created_at)}
                        </td>
                        <td className="px-4 py-3 max-w-32">
                          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                          {email && <p className="text-xs text-gray-400 truncate">{email}</p>}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">
                          {fmt(s.amount, s.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.cls}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                          {s.order_id || '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
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
      </div>

      {/* ── Detail drawer ── */}
      {selectedId && (
        <div className="lg:w-[40%] lg:min-w-96 border-l border-gray-200 bg-white overflow-y-auto flex flex-col lg:sticky lg:top-0 lg:max-h-screen">
          {/* Drawer header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
            <span className="text-sm font-semibold text-gray-900">Order Detail</span>
            <button
              onClick={() => setSelectedId(null)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : !detail ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              Failed to load details
            </div>
          ) : (
            <DetailContent
              detail={detail}
              rawOpen={rawOpen}
              setRawOpen={setRawOpen}
              copied={copied}
              copyId={copyId}
              fmt={fmt}
              fmtDate={fmtDate}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Detail content ────────────────────────────────────────────────────────────

function DetailContent({
  detail, rawOpen, setRawOpen, copied, copyId, fmt, fmtDate,
}: {
  detail: { session: SessionDetail; giftCard: unknown }
  rawOpen: boolean
  setRawOpen: (v: boolean) => void
  copied: boolean
  copyId: (id: string) => void
  fmt: (n: number, currency?: string) => string
  fmtDate: (iso: string) => string
}) {
  const { session, giftCard } = detail
  const meta = STATUS[session.status] || STATUS.pending
  const gc = giftCard as {
    code?: string; discount_type?: string; discount_value?: number
    original_amount?: number; balance?: number; currency?: string; status?: string
  } | null

  const storedGC = session.raw_response?._gift_card as {
    code?: string; appliedAmount?: number
  } | null

  const shopifyUrl = session.order_id
    ? `https://${session.shop}/admin/orders`
    : null

  return (
    <div className="flex-1 divide-y divide-gray-100">
      {/* Summary */}
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xl font-bold text-gray-900">{fmt(session.amount, session.currency)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{fmtDate(session.created_at)}</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${meta.cls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
        </div>

        {/* Session ID */}
        <div className="flex items-center gap-2">
          <p className="text-xs font-mono text-gray-400 flex-1 truncate">{session.id}</p>
          <button
            onClick={() => copyId(session.id)}
            className="p-1 rounded hover:bg-gray-100 text-gray-400"
            title="Copy session ID"
          >
            {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Shopify link */}
        {shopifyUrl && (
          <a
            href={shopifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Order #{session.order_id} on Shopify
          </a>
        )}

        {/* Transaction ID */}
        {session.tranzila_transaction_id && (
          <p className="text-xs text-gray-400">
            Tranzila ref: <span className="font-mono">{session.tranzila_transaction_id}</span>
          </p>
        )}

        {/* Error */}
        {session.error_message && (
          <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
            {session.error_message}
          </div>
        )}
      </div>

      {/* Customer */}
      {session.customer && (
        <Section icon={<User className="h-4 w-4" />} title="Customer">
          <dl className="space-y-1.5 text-sm">
            {(session.customer.firstName || session.customer.lastName) && (
              <Row label="Name" value={`${session.customer.firstName || ''} ${session.customer.lastName || ''}`.trim()} />
            )}
            {session.customer.email && <Row label="Email" value={session.customer.email} />}
            {session.customer.phone && <Row label="Phone" value={session.customer.phone} />}
          </dl>
        </Section>
      )}

      {/* Shipping address */}
      {session.customer?.address && (
        <Section icon={<MapPin className="h-4 w-4" />} title="Address">
          <p className="text-sm text-gray-700">
            {session.customer.address}
            {session.customer.city && `, ${session.customer.city}`}
            {session.customer.country && `, ${session.customer.country}`}
          </p>
        </Section>
      )}

      {/* Cart items */}
      {session.cart?.items && session.cart.items.length > 0 && (
        <Section icon={<Package className="h-4 w-4" />} title="Items">
          <div className="space-y-3">
            {session.cart.items.map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                {item.image && (
                  <img
                    src={item.image}
                    alt={item.title}
                    className="h-10 w-10 rounded-lg object-cover border border-gray-100 flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{item.title}</p>
                  {item.variant && <p className="text-xs text-gray-400">{item.variant}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-medium text-gray-900">{fmt(item.price * item.quantity)}</p>
                  <p className="text-xs text-gray-400">×{item.quantity}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Payment breakdown */}
      {session.cart && (
        <Section icon={<CreditCard className="h-4 w-4" />} title="Payment">
          <dl className="space-y-1.5">
            {session.cart.subtotal != null && (
              <Row label="Subtotal" value={fmt(session.cart.subtotal, session.cart.currency)} />
            )}
            {session.cart.shipping != null && (
              <Row
                label="Shipping"
                value={session.cart.shipping === 0 ? 'Free' : fmt(session.cart.shipping, session.cart.currency)}
              />
            )}
            {session.cart.tax != null && session.cart.tax > 0 && (
              <Row label="Tax" value={fmt(session.cart.tax, session.cart.currency)} />
            )}
            {storedGC?.appliedAmount != null && (
              <Row
                label="Gift card"
                value={`−${fmt(storedGC.appliedAmount, session.cart.currency)}`}
                valueClass="text-green-600"
              />
            )}
            <div className="pt-1.5 mt-1 border-t border-gray-100 flex justify-between">
              <span className="text-sm font-semibold text-gray-900">Total</span>
              <span className="text-sm font-bold text-gray-900">{fmt(session.amount, session.currency)}</span>
            </div>
          </dl>
        </Section>
      )}

      {/* Gift card used */}
      {gc && (
        <Section icon={<Gift className="h-4 w-4" />} title="Gift Card Used">
          <dl className="space-y-1.5">
            <Row label="Code" value={gc.code || '—'} mono />
            <Row label="Type" value={gc.discount_type === 'percentage' ? `${gc.discount_value}% off` : 'Amount'} />
            {storedGC?.appliedAmount != null && (
              <Row label="Applied" value={fmt(storedGC.appliedAmount, gc.currency)} />
            )}
            {gc.balance != null && <Row label="Remaining" value={fmt(gc.balance, gc.currency)} />}
          </dl>
        </Section>
      )}

      {/* Raw response */}
      {session.raw_response && (
        <div className="px-5 py-4">
          <button
            onClick={() => setRawOpen(!rawOpen)}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-800 transition-colors w-full text-left"
          >
            {rawOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Raw payment response
          </button>
          {rawOpen && (
            <pre className="mt-3 text-xs bg-gray-50 border border-gray-100 rounded-xl p-3 overflow-auto max-h-64 text-gray-600">
              {JSON.stringify(session.raw_response, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function Section({
  icon, title, children,
}: {
  icon: React.ReactNode; title: string; children: React.ReactNode
}) {
  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-gray-400">{icon}</span>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Row({
  label, value, mono, valueClass,
}: {
  label: string; value: string; mono?: boolean; valueClass?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-gray-400 flex-shrink-0">{label}</dt>
      <dd className={`text-sm text-right break-all ${mono ? 'font-mono' : ''} ${valueClass || 'text-gray-700'}`}>
        {value}
      </dd>
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

function FilterTab({
  active, onClick, children,
}: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

function PgBtn({
  disabled, onClick, children,
}: {
  disabled: boolean; onClick: () => void; children: React.ReactNode
}) {
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
