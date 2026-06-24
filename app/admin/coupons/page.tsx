'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Tag, Plus, Search, Copy, Ban, CheckCircle2, ChevronLeft, ChevronRight,
  Percent, RefreshCw, X, Loader2, Activity, Ticket, ShoppingBag, Package,
} from 'lucide-react'
import { useAdmin } from '@/lib/admin-context'
import { useAdminLanguage } from '@/lib/admin-language-context'

interface CouponRecord {
  id: string
  code: string
  discount_type: 'amount' | 'percentage'
  discount_value: number
  currency: string
  status: 'active' | 'disabled' | 'depleted'
  max_uses: number | null
  current_uses: number
  note: string | null
  applies_to_all: boolean
  allowed_variant_ids: number[]
  created_at: string
}

interface ShopifyVariant { id: number; title: string }
interface ShopifyProduct { id: number; title: string; variants: ShopifyVariant[] }

interface Stats {
  total: number
  active: number
  depleted: number
  disabled: number
  totalUses: number
  percentageCoupons: number
}

const LIMIT = 20

export default function CouponsAdminPage() {
  const { apiFetch } = useAdmin()
  const { t } = useAdminLanguage()

  const [coupons, setCoupons] = useState<CouponRecord[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

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

  const [showCreate, setShowCreate] = useState(false)
  const [createType, setCreateType] = useState<'amount' | 'percentage'>('percentage')
  const [createValue, setCreateValue] = useState('')
  const [createCode, setCreateCode] = useState('')
  const [createMaxUses, setCreateMaxUses] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [createQty, setCreateQty] = useState(1)
  const [isCreating, setIsCreating] = useState(false)
  const [createResult, setCreateResult] = useState<CouponRecord[] | null>(null)
  const [createError, setCreateError] = useState('')

  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [productCoupon, setProductCoupon] = useState<CouponRecord | null>(null)

  const fetchCoupons = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    const params = new URLSearchParams({
      page: String(page),
      status: statusFilter,
      type: typeFilter,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    })
    try {
      const res = await apiFetch(`/api/admin/coupons?${params}`)
      const data = await res.json()
      if (!res.ok) { setLoadError(data.error || t('coupons.failedToLoad')); return }
      setCoupons(data.coupons || [])
      setTotal(data.total || 0)
      if (data.stats) setStats(data.stats)
    } catch {
      setLoadError(t('coupons.errorNetwork'))
    } finally {
      setIsLoading(false)
    }
  }, [apiFetch, page, statusFilter, typeFilter, debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchCoupons() }, [fetchCoupons])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreateResult(null)

    const value = Number(createValue)
    if (!value || value <= 0) { setCreateError(t('coupons.errorValue')); return }
    if (createType === 'percentage' && value > 100) { setCreateError(t('coupons.errorPct')); return }

    setIsCreating(true)
    try {
      const res = await apiFetch('/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discountType: createType,
          discountValue: value,
          code: createCode || undefined,
          maxUses: createMaxUses ? Number(createMaxUses) : undefined,
          note: createNote || undefined,
          quantity: createQty,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setCreateError(data.error || t('coupons.errorCreate')); return }
      setCreateResult(data.coupons)
      setCreateValue('')
      setCreateCode('')
      setCreateMaxUses('')
      setCreateNote('')
      setCreateQty(1)
      fetchCoupons()
    } catch {
      setCreateError(t('coupons.errorNetwork'))
    } finally {
      setIsCreating(false)
    }
  }

  const handleToggleStatus = async (coupon: CouponRecord) => {
    const newStatus = coupon.status === 'disabled' ? 'active' : 'disabled'
    setUpdatingId(coupon.id)
    try {
      const res = await apiFetch(`/api/admin/coupons/${coupon.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        setCoupons((prev) => prev.map((c) => c.id === coupon.id ? { ...c, status: newStatus } : c))
      }
    } finally {
      setUpdatingId(null)
    }
  }

  const handleSaveProductRestriction = (updated: CouponRecord) => {
    setCoupons((prev) => prev.map((c) => c.id === updated.id ? { ...c, ...updated } : c))
    setProductCoupon(null)
  }

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const formatCurrency = (amount: number, currency = 'ILS') =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(amount)

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  const totalPages = Math.ceil(total / LIMIT)

  const generateLabel = createQty > 1
    ? t('coupons.generateCoupons', { n: createQty })
    : t('coupons.generateCoupon')

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">{t('coupons.title')}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchCoupons}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors border border-gray-200"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => { setShowCreate(true); setCreateResult(null); setCreateError('') }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-900 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('coupons.createBtn')}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard icon={<Ticket  className="h-5 w-5 text-gray-600" />}   label={t('coupons.statTotal')}     value={stats.total} />
          <StatCard icon={<Activity className="h-5 w-5 text-green-600" />} label={t('coupons.statActive')}    value={stats.active}               color="green" />
          <StatCard icon={<Tag     className="h-5 w-5 text-blue-600" />}   label={t('coupons.statTotalUses')} value={stats.totalUses}             color="blue" />
          <StatCard icon={<Percent className="h-5 w-5 text-purple-600" />} label={t('coupons.statPct')}       value={stats.percentageCoupons}     color="purple" />
        </div>
      )}

      {/* Create panel */}
      {showCreate && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-gray-500" />
              <span className="font-medium text-gray-900">{t('coupons.createTitle')}</span>
            </div>
            <button onClick={() => { setShowCreate(false); setCreateResult(null) }} className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          {createResult ? (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">
                  {t('coupons.createdSuccess', { count: createResult.length, plural: createResult.length > 1 ? 's' : '' })}
                </span>
              </div>
              <div className="grid gap-2">
                {createResult.map((coupon) => (
                  <div key={coupon.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-gray-50 border border-gray-200">
                    <div>
                      <span className="font-mono font-medium text-gray-900 text-sm">{coupon.code}</span>
                      <span className="ml-3 text-xs text-gray-500">
                        {coupon.discount_type === 'percentage'
                          ? `${coupon.discount_value}% off`
                          : formatCurrency(coupon.discount_value, coupon.currency)
                        }
                        {coupon.max_uses
                          ? ` · ${t('coupons.maxUses', { count: coupon.max_uses })}`
                          : ` · ${t('coupons.unlimitedUses')}`
                        }
                      </span>
                    </div>
                    <button
                      onClick={() => handleCopy(coupon.code)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
                    >
                      {copiedCode === coupon.code ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedCode === coupon.code ? t('giftCards.copied') : t('giftCards.copy')}
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setCreateResult(null)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {t('coupons.createAnother')}
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">{t('coupons.discountType')}</label>
                <div className="flex gap-2">
                  <TypeButton
                    active={createType === 'percentage'}
                    onClick={() => setCreateType('percentage')}
                    icon={<Percent className="h-4 w-4" />}
                    label={t('coupons.pctOff')}
                    desc={t('coupons.pctOffDesc')}
                  />
                  <TypeButton
                    active={createType === 'amount'}
                    onClick={() => setCreateType('amount')}
                    icon={<Tag className="h-4 w-4" />}
                    label={t('coupons.amountOff')}
                    desc={t('coupons.amountOffDesc')}
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label={createType === 'percentage' ? t('coupons.pctField') : t('coupons.amountField')} required>
                  <div className="relative">
                    {createType === 'amount' && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₪</span>
                    )}
                    <input
                      type="number"
                      min="1"
                      max={createType === 'percentage' ? '100' : undefined}
                      step={createType === 'percentage' ? '1' : '0.01'}
                      value={createValue}
                      onChange={(e) => setCreateValue(e.target.value)}
                      placeholder={createType === 'percentage' ? '20' : '100'}
                      className={`w-full py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 ${
                        createType === 'amount' ? 'pl-7 pr-4' : 'pl-4 pr-8'
                      }`}
                      required
                    />
                    {createType === 'percentage' && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                    )}
                  </div>
                </Field>

                <Field label={t('coupons.quantity')}>
                  <input
                    type="number" min="1" max="20"
                    value={createQty}
                    onChange={(e) => setCreateQty(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                  />
                </Field>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label={t('coupons.customCode')}>
                  <input
                    type="text"
                    value={createCode}
                    onChange={(e) => setCreateCode(e.target.value.toUpperCase())}
                    placeholder="e.g. SUMMER20"
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black/20"
                    spellCheck={false}
                  />
                </Field>
                <Field label={t('coupons.maxUsesField')}>
                  <input
                    type="number" min="1"
                    value={createMaxUses}
                    onChange={(e) => setCreateMaxUses(e.target.value)}
                    placeholder={t('coupons.unlimitedUses')}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                  />
                </Field>
              </div>

              <Field label={t('coupons.noteField')}>
                <input
                  type="text"
                  value={createNote}
                  onChange={(e) => setCreateNote(e.target.value)}
                  placeholder="e.g. Summer 2025 campaign"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                />
              </Field>

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
                  {isCreating ? t('coupons.generating') : generateLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  {t('coupons.cancel')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t('coupons.searchPlaceholder')}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
          />
        </div>

        <Select
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1) }}
          options={[
            { value: 'all',      label: t('coupons.allStatuses') },
            { value: 'active',   label: t('status.active') },
            { value: 'depleted', label: t('status.depleted') },
            { value: 'disabled', label: t('status.disabled') },
          ]}
        />

        <Select
          value={typeFilter}
          onChange={(v) => { setTypeFilter(v); setPage(1) }}
          options={[
            { value: 'all',        label: t('coupons.allTypes') },
            { value: 'percentage', label: t('coupons.pctOffFilter') },
            { value: 'amount',     label: t('coupons.amountOffFilter') },
          ]}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loadError && (
          <div className="p-6 text-center text-red-600 text-sm">{loadError}</div>
        )}

        {!loadError && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <Th>{t('coupons.colCode')}</Th>
                  <Th>{t('coupons.colType')}</Th>
                  <Th>{t('coupons.colValue')}</Th>
                  <Th>{t('coupons.colUses')}</Th>
                  <Th>{t('coupons.colStatus')}</Th>
                  <Th>{t('coupons.colNote')}</Th>
                  <Th>{t('coupons.colProducts')}</Th>
                  <Th>{t('coupons.colCreated')}</Th>
                  <Th align="right">{t('coupons.colActions')}</Th>
                </tr>
              </thead>
              <tbody>
                {isLoading && coupons.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400 mx-auto" />
                    </td>
                  </tr>
                ) : coupons.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-gray-400 text-sm">
                      {t('coupons.noCoupons')}
                    </td>
                  </tr>
                ) : (
                  coupons.map((coupon) => (
                    <tr
                      key={coupon.id}
                      className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${
                        coupon.status === 'disabled' ? 'opacity-50' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-medium text-gray-900 tracking-wide">{coupon.code}</span>
                      </td>
                      <td className="px-4 py-3">
                        {coupon.discount_type === 'percentage' ? (
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
                        {coupon.discount_type === 'percentage'
                          ? <span className="text-purple-700">{coupon.discount_value}%</span>
                          : formatCurrency(coupon.discount_value, coupon.currency)
                        }
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {coupon.current_uses}
                        {coupon.max_uses != null ? ` / ${coupon.max_uses}` : ' / ∞'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={coupon.status} t={t} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-32 truncate">
                        {coupon.note || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setProductCoupon(coupon)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors hover:opacity-80 ${
                            coupon.applies_to_all === false && coupon.allowed_variant_ids?.length > 0
                              ? 'bg-blue-50 text-blue-700 border-blue-100'
                              : 'bg-gray-50 text-gray-600 border-gray-200'
                          }`}
                        >
                          <Package className="h-3 w-3" />
                          {coupon.applies_to_all === false && coupon.allowed_variant_ids?.length > 0
                            ? t('coupons.variants', {
                                count: coupon.allowed_variant_ids.length,
                                plural: coupon.allowed_variant_ids.length > 1 ? 's' : '',
                              })
                            : t('coupons.allVariants')
                          }
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {formatDate(coupon.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleCopy(coupon.code)}
                            title={t('giftCards.copy')}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                          >
                            {copiedCode === coupon.code
                              ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                              : <Copy className="h-4 w-4" />
                            }
                          </button>
                          {coupon.status !== 'depleted' && (
                            <button
                              onClick={() => handleToggleStatus(coupon)}
                              disabled={updatingId === coupon.id}
                              title={coupon.status === 'disabled' ? t('status.active') : t('status.disabled')}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                            >
                              {updatingId === coupon.id
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : coupon.status === 'disabled'
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

      {productCoupon && (
        <ProductPickerModal
          coupon={productCoupon}
          apiFetch={apiFetch}
          onClose={() => setProductCoupon(null)}
          onSave={handleSaveProductRestriction}
          t={t}
        />
      )}
    </div>
  )
}

// ── Reusable sub-components ───────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number; color?: 'green' | 'blue' | 'purple'
}) {
  const bg = color === 'green' ? 'bg-green-50' : color === 'blue' ? 'bg-blue-50' : color === 'purple' ? 'bg-purple-50' : 'bg-gray-50'
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <div className={`inline-flex items-center justify-center h-9 w-9 rounded-xl ${bg} mb-3`}>{icon}</div>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function StatusBadge({ status, t }: {
  status: CouponRecord['status']
  t: (key: string) => string
}) {
  const map = {
    active:   'bg-green-50 text-green-700 border-green-100',
    depleted: 'bg-gray-50 text-gray-500 border-gray-100',
    disabled: 'bg-red-50 text-red-600 border-red-100',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[status]}`}>
      {t(`status.${status}`)}
    </span>
  )
}

function TypeButton({ active, onClick, icon, label, desc }: {
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

function Select({ value, onChange, options }: {
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

function PageBtn({ children, disabled, onClick }: {
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

function ProductPickerModal({ coupon, apiFetch, onClose, onSave, t }: {
  coupon: CouponRecord
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>
  onClose: () => void
  onSave: (updated: CouponRecord) => void
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const [products, setProducts] = useState<ShopifyProduct[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [appliesAll, setAppliesAll] = useState(coupon.applies_to_all !== false)
  const [selectedVariants, setSelectedVariants] = useState<Set<number>>(
    new Set(coupon.allowed_variant_ids ?? [])
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    apiFetch('/api/admin/products')
      .then((r) => r.json())
      .then((data: ShopifyProduct[]) => setProducts(data))
      .catch(() => setLoadError(t('productPicker.failedToLoad')))
      .finally(() => setLoadingProducts(false))
  }, [apiFetch]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleVariant = (variantId: number) => {
    setSelectedVariants((prev) => {
      const next = new Set(prev)
      if (next.has(variantId)) next.delete(variantId)
      else next.add(variantId)
      return next
    })
  }

  const toggleAllVariantsForProduct = (product: ShopifyProduct) => {
    const ids = product.variants.map((v) => v.id)
    const allSelected = ids.every((id) => selectedVariants.has(id))
    setSelectedVariants((prev) => {
      const next = new Set(prev)
      if (allSelected) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const body: Record<string, unknown> = { applies_to_all: appliesAll }
      if (!appliesAll) body.allowed_variant_ids = Array.from(selectedVariants)
      else body.allowed_variant_ids = []

      const res = await apiFetch(`/api/admin/coupons/${coupon.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setSaveError(data.error || t('productPicker.updateFailed')); return }
      onSave(data.coupon)
    } catch {
      setSaveError(t('productPicker.networkError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-gray-500" />
              <span className="font-medium text-gray-900">{t('productPicker.title')}</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('productPicker.couponLabel')} <span className="font-mono">{coupon.code}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Segmented control */}
        <div className="px-6 pt-4 pb-3 shrink-0">
          <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-gray-50 p-1 gap-1">
            <button
              onClick={() => setAppliesAll(true)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                appliesAll ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t('productPicker.allProducts')}
            </button>
            <button
              onClick={() => setAppliesAll(false)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                !appliesAll ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t('productPicker.specificProducts')}
            </button>
          </div>
        </div>

        {/* Product list */}
        {!appliesAll && (
          <div className="flex-1 overflow-y-auto px-6 pb-2">
            {loadingProducts ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : loadError ? (
              <p className="text-sm text-red-600 py-6 text-center">{loadError}</p>
            ) : (
              <div className="space-y-3">
                {products.map((product) => {
                  const allSelected = product.variants.every((v) => selectedVariants.has(v.id))
                  const someSelected = product.variants.some((v) => selectedVariants.has(v.id))
                  return (
                    <div key={product.id} className="rounded-xl border border-gray-200 overflow-hidden">
                      <button
                        onClick={() => toggleAllVariantsForProduct(product)}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                      >
                        <span className={`flex-shrink-0 h-4 w-4 rounded border-2 flex items-center justify-center ${
                          allSelected ? 'bg-black border-black' : someSelected ? 'border-black bg-gray-200' : 'border-gray-300'
                        }`}>
                          {allSelected && <span className="block h-2 w-2 bg-white rounded-sm" />}
                          {!allSelected && someSelected && <span className="block h-0.5 w-2 bg-black" />}
                        </span>
                        <span className="text-sm font-medium text-gray-900">{product.title}</span>
                        <span className="ml-auto text-xs text-gray-400">
                          {product.variants.length} {product.variants.length > 1 ? t('productPicker.variantPlural') : t('productPicker.variantSingular')}
                        </span>
                      </button>
                      {product.variants.length > 1 && (
                        <div className="divide-y divide-gray-100">
                          {product.variants.map((variant) => (
                            <button
                              key={variant.id}
                              onClick={() => toggleVariant(variant.id)}
                              className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-50 transition-colors text-left"
                            >
                              <span className={`flex-shrink-0 h-4 w-4 rounded border-2 flex items-center justify-center ${
                                selectedVariants.has(variant.id) ? 'bg-black border-black' : 'border-gray-300'
                              }`}>
                                {selectedVariants.has(variant.id) && <span className="block h-2 w-2 bg-white rounded-sm" />}
                              </span>
                              <span className="text-xs text-gray-600">{variant.title}</span>
                              <span className="ml-auto text-xs text-gray-400 font-mono">{variant.id}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 space-y-2">
          {!appliesAll && (
            <p className="text-xs text-gray-500">
              {t('productPicker.variantsSelected', {
                count: selectedVariants.size,
                plural: selectedVariants.size !== 1 ? 's' : '',
              })}
            </p>
          )}
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || (!appliesAll && selectedVariants.size === 0)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-900 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {t('productPicker.save')}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {t('productPicker.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
