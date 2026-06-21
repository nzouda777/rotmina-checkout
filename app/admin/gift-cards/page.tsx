'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Gift, Plus, Search, Copy, Ban, CheckCircle2, ChevronLeft, ChevronRight,
  Percent, Tag, RefreshCw, X, Loader2, CreditCard, TrendingUp, Activity,
} from 'lucide-react'
import { useAdmin } from '@/lib/admin-context'

interface GiftCardRecord {
  id: string
  code: string
  original_amount: number | null
  balance: number | null
  currency: string
  status: 'active' | 'depleted' | 'disabled'
  discount_type: 'amount' | 'percentage'
  discount_value: number | null
  buyer_email: string | null
  recipient_name: string | null
  recipient_email: string | null
  personal_message: string | null
  created_at: string
  last_used_at: string | null
}

interface Stats {
  total: number
  active: number
  depleted: number
  disabled: number
  percentageCards: number
  totalAmountIssued: number
}

const LIMIT = 20

export default function GiftCardAdminPage() {
  const { apiFetch } = useAdmin()

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [cards, setCards] = useState<GiftCardRecord[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = (v: string) => {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setDebouncedSearch(v); setPage(1) }, 400)
  }

  // ── Create form ───────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false)
  const [createType, setCreateType] = useState<'amount' | 'percentage'>('amount')
  const [createAmount, setCreateAmount] = useState('')
  const [createPercentage, setCreatePercentage] = useState('')
  const [createCode, setCreateCode] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [createQty, setCreateQty] = useState(1)
  const [isCreating, setIsCreating] = useState(false)
  const [createResult, setCreateResult] = useState<GiftCardRecord[] | null>(null)
  const [createError, setCreateError] = useState('')

  // ── Inline actions ────────────────────────────────────────────────────────────
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // ── Fetch cards ───────────────────────────────────────────────────────────────
  const fetchCards = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const params = new URLSearchParams({
      page: String(page),
      status: statusFilter,
      type: typeFilter,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    })

    try {
      const res = await apiFetch(`/api/admin/gift-cards?${params}`)
      const data = await res.json()
      if (!res.ok) { setLoadError(data.error || 'Failed to load'); return }

      setCards(data.cards || [])
      setTotal(data.total || 0)
      if (data.stats) setStats(data.stats)
    } catch {
      setLoadError('Network error — please try again')
    } finally {
      setIsLoading(false)
    }
  }, [apiFetch, page, statusFilter, typeFilter, debouncedSearch])

  useEffect(() => { fetchCards() }, [fetchCards])

  // ── Create ────────────────────────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreateResult(null)

    if (createType === 'amount' && (!createAmount || Number(createAmount) <= 0)) {
      setCreateError('Amount must be greater than 0')
      return
    }
    if (createType === 'percentage') {
      const pct = Number(createPercentage)
      if (!pct || pct < 1 || pct > 100) { setCreateError('Percentage must be 1–100'); return }
    }

    setIsCreating(true)
    try {
      const res = await apiFetch('/api/admin/gift-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discountType: createType,
          amount: createType === 'amount' ? Number(createAmount) : undefined,
          discountValue: createType === 'percentage' ? Number(createPercentage) : undefined,
          code: createCode || undefined,
          recipientEmail: createEmail || undefined,
          note: createNote || undefined,
          quantity: createQty,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setCreateError(data.error || 'Failed to create'); return }

      setCreateResult(data.cards)
      setCreateAmount('')
      setCreatePercentage('')
      setCreateCode('')
      setCreateEmail('')
      setCreateNote('')
      setCreateQty(1)
      fetchCards()
    } catch {
      setCreateError('Network error — please try again')
    } finally {
      setIsCreating(false)
    }
  }

  // ── Toggle status ─────────────────────────────────────────────────────────────
  const handleToggleStatus = async (card: GiftCardRecord) => {
    const newStatus = card.status === 'disabled' ? 'active' : 'disabled'
    setUpdatingId(card.id)
    try {
      const res = await apiFetch(`/api/admin/gift-cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        setCards((prev) => prev.map((c) => c.id === card.id ? { ...c, status: newStatus } : c))
      }
    } finally {
      setUpdatingId(null)
    }
  }

  // ── Copy ──────────────────────────────────────────────────────────────────────
  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const formatCurrency = (amount: number | null, currency = 'ILS') => {
    if (amount == null) return '—'
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(amount)
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Gift Cards</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchCards}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors border border-gray-200"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => { setShowCreate(true); setCreateResult(null); setCreateError('') }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-900 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create Gift Card
            </button>
          </div>
      </div>

      {/* ── Stats ── */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard icon={<Gift className="h-5 w-5 text-gray-600" />} label="Total Cards" value={stats.total} />
            <StatCard icon={<Activity className="h-5 w-5 text-green-600" />} label="Active" value={stats.active} color="green" />
            <StatCard icon={<CreditCard className="h-5 w-5 text-blue-600" />} label="Amount Issued" value={formatCurrency(stats.totalAmountIssued)} color="blue" />
            <StatCard icon={<Percent className="h-5 w-5 text-purple-600" />} label="% Cards" value={stats.percentageCards} color="purple" />
          </div>
        )}

        {/* ── Create panel ── */}
        {showCreate && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-gray-500" />
                <span className="font-medium text-gray-900">Create Gift Card</span>
              </div>
              <button onClick={() => { setShowCreate(false); setCreateResult(null) }} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {createResult ? (
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">{createResult.length} gift card{createResult.length > 1 ? 's' : ''} created successfully</span>
                </div>
                <div className="grid gap-2">
                  {createResult.map((card) => (
                    <div key={card.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-gray-50 border border-gray-200">
                      <div>
                        <span className="font-mono font-medium text-gray-900 text-sm">{card.code}</span>
                        <span className="ml-3 text-xs text-gray-500">
                          {card.discount_type === 'percentage'
                            ? `${card.discount_value}% off`
                            : formatCurrency(card.original_amount, card.currency)
                          }
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopy(card.code)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
                      >
                        {copiedCode === card.code ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedCode === card.code ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => { setCreateResult(null) }}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Create another
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="p-6 space-y-5">
                {/* Type selector */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Discount Type</label>
                  <div className="flex gap-2">
                    <TypeButton
                      active={createType === 'amount'}
                      onClick={() => setCreateType('amount')}
                      icon={<Tag className="h-4 w-4" />}
                      label="Amount Off"
                      desc="Fixed ₪ discount"
                    />
                    <TypeButton
                      active={createType === 'percentage'}
                      onClick={() => setCreateType('percentage')}
                      icon={<Percent className="h-4 w-4" />}
                      label="Percentage Off"
                      desc="% of cart total"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  {/* Value */}
                  {createType === 'amount' ? (
                    <Field label="Amount (ILS)" required>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₪</span>
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={createAmount}
                          onChange={(e) => setCreateAmount(e.target.value)}
                          placeholder="200"
                          className="w-full pl-7 pr-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                          required
                        />
                      </div>
                    </Field>
                  ) : (
                    <Field label="Percentage" required>
                      <div className="relative">
                        <input
                          type="number"
                          min="1"
                          max="100"
                          step="1"
                          value={createPercentage}
                          onChange={(e) => setCreatePercentage(e.target.value)}
                          placeholder="20"
                          className="w-full pl-4 pr-8 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                          required
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                      </div>
                    </Field>
                  )}

                  {/* Quantity */}
                  <Field label="Quantity (max 20)">
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={createQty}
                      onChange={(e) => setCreateQty(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                    />
                  </Field>
                </div>

                {/* Custom code */}
                <Field label="Custom code (optional — leave blank to auto-generate)">
                  <input
                    type="text"
                    value={createCode}
                    onChange={(e) => setCreateCode(e.target.value.toUpperCase())}
                    placeholder="e.g. ROTM-VIP1-2025-X"
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black/20"
                    spellCheck={false}
                  />
                  {createCode && (
                    <p className="text-xs text-gray-400 mt-1">Quantity will be set to 1 when using a custom code.</p>
                  )}
                </Field>

                <div className="grid sm:grid-cols-2 gap-4">
                  {/* Recipient email */}
                  <Field label="Recipient email (optional)">
                    <input
                      type="email"
                      value={createEmail}
                      onChange={(e) => setCreateEmail(e.target.value)}
                      placeholder="customer@example.com"
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                    />
                  </Field>

                  {/* Note */}
                  <Field label="Internal note (optional)">
                    <input
                      type="text"
                      value={createNote}
                      onChange={(e) => setCreateNote(e.target.value)}
                      placeholder="e.g. VIP customer reward"
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                    />
                  </Field>
                </div>

                {createError && (
                  <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{createError}</p>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-900 transition-colors disabled:opacity-50"
                  >
                    {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {isCreating ? 'Generating…' : `Generate ${createQty > 1 ? createQty + ' cards' : 'card'}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search code or email…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
            />
          </div>

          <Select
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1) }}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'depleted', label: 'Depleted' },
              { value: 'disabled', label: 'Disabled' },
            ]}
          />

          <Select
            value={typeFilter}
            onChange={(v) => { setTypeFilter(v); setPage(1) }}
            options={[
              { value: 'all', label: 'All types' },
              { value: 'amount', label: 'Amount off' },
              { value: 'percentage', label: 'Percentage off' },
            ]}
          />
        </div>

        {/* ── Table ── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {loadError && (
            <div className="p-6 text-center text-red-600 text-sm">{loadError}</div>
          )}

          {!loadError && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <Th>Code</Th>
                    <Th>Type</Th>
                    <Th>Value</Th>
                    <Th>Balance</Th>
                    <Th>Status</Th>
                    <Th>Recipient</Th>
                    <Th>Created</Th>
                    <Th align="right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && cards.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center">
                        <Loader2 className="h-6 w-6 animate-spin text-gray-400 mx-auto" />
                      </td>
                    </tr>
                  ) : cards.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-gray-400 text-sm">
                        No gift cards found
                      </td>
                    </tr>
                  ) : (
                    cards.map((card) => (
                      <tr
                        key={card.id}
                        className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${
                          card.status === 'disabled' ? 'opacity-50' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-medium text-gray-900 tracking-wide">
                            {card.code}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {card.discount_type === 'percentage' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100">
                              <Percent className="h-3 w-3" /> %
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                              <Tag className="h-3 w-3" /> ₪
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {card.discount_type === 'percentage'
                            ? <span className="text-purple-700">{card.discount_value}%</span>
                            : formatCurrency(card.original_amount, card.currency)
                          }
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {card.discount_type === 'percentage'
                            ? <span className="text-xs text-gray-400">single-use</span>
                            : card.balance != null
                              ? card.balance < (card.original_amount ?? 0)
                                ? <span className="text-amber-600">{formatCurrency(card.balance, card.currency)}</span>
                                : formatCurrency(card.balance, card.currency)
                              : '—'
                          }
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={card.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-32 truncate">
                          {card.recipient_email || card.buyer_email || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                          {formatDate(card.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleCopy(card.code)}
                              title="Copy code"
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                            >
                              {copiedCode === card.code
                                ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                                : <Copy className="h-4 w-4" />
                              }
                            </button>
                            {card.status !== 'depleted' && (
                              <button
                                onClick={() => handleToggleStatus(card)}
                                disabled={updatingId === card.id}
                                title={card.status === 'disabled' ? 'Re-enable' : 'Disable'}
                                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                              >
                                {updatingId === card.id
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : card.status === 'disabled'
                                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                                    : <Ban className="h-4 w-4" />
                                }
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <PageBtn disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </PageBtn>
                <span className="px-3 text-sm text-gray-700">{page} / {totalPages}</span>
                <PageBtn disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </PageBtn>
              </div>
            </div>
          )}
        </div>
    </div>
  )
}

// ── Small reusable components ──────────────────────────────────────────────────

function StatCard({
  icon, label, value, color,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  color?: 'green' | 'blue' | 'purple'
}) {
  const bg = color === 'green' ? 'bg-green-50' : color === 'blue' ? 'bg-blue-50' : color === 'purple' ? 'bg-purple-50' : 'bg-gray-50'
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <div className={`inline-flex items-center justify-center h-9 w-9 rounded-xl ${bg} mb-3`}>
        {icon}
      </div>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: GiftCardRecord['status'] }) {
  const map = {
    active: 'bg-green-50 text-green-700 border-green-100',
    depleted: 'bg-gray-50 text-gray-500 border-gray-100',
    disabled: 'bg-red-50 text-red-600 border-red-100',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function TypeButton({
  active, onClick, icon, label, desc,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; desc: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-start gap-3 px-4 py-3 rounded-xl border-2 transition-colors text-left ${
        active ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <span className={`mt-0.5 ${active ? 'text-black' : 'text-gray-400'}`}>{icon}</span>
      <span>
        <span className={`block text-sm font-medium ${active ? 'text-black' : 'text-gray-600'}`}>{label}</span>
        <span className="block text-xs text-gray-400">{desc}</span>
      </span>
    </button>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

function Select({
  value, onChange, options,
}: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-black/20 text-gray-700"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function PageBtn({
  children, disabled, onClick,
}: {
  children: React.ReactNode; disabled: boolean; onClick: () => void
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
