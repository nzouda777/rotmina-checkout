'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  TrendingUp, ShoppingBag, CheckCircle2, XCircle, Clock,
  Gift, ArrowRight, RefreshCw, Loader2, CreditCard, Activity,
} from 'lucide-react'
import { useAdmin } from '@/lib/admin-context'
import { useAdminLanguage } from '@/lib/admin-language-context'

interface DashboardData {
  revenue: { today: number; thisWeek: number; thisMonth: number; allTime: number }
  orders: Record<string, number> & { total: number; paid: number; failed: number; active: number }
  successRate: number
  avgOrderValue: number
  recentOrders: {
    status: string; amount: number; created_at: string
    customer?: { email?: string; firstName?: string; lastName?: string }
    order_id?: string
  }[]
  giftCards: { total: number; active: number; totalAmountIssued: number }
}

const STATUS_STYLE: Record<string, { color: string; dot: string }> = {
  paid:        { color: 'text-green-700 bg-green-50 border-green-100',    dot: 'bg-green-500' },
  failed:      { color: 'text-red-700 bg-red-50 border-red-100',          dot: 'bg-red-500' },
  pending:     { color: 'text-amber-700 bg-amber-50 border-amber-100',    dot: 'bg-amber-400' },
  processing:  { color: 'text-blue-700 bg-blue-50 border-blue-100',       dot: 'bg-blue-500' },
  pending_3ds: { color: 'text-purple-700 bg-purple-50 border-purple-100', dot: 'bg-purple-500' },
  pending_bit: { color: 'text-orange-700 bg-orange-50 border-orange-100', dot: 'bg-orange-400' },
  expired:     { color: 'text-gray-500 bg-gray-50 border-gray-100',       dot: 'bg-gray-400' },
}

export default function DashboardPage() {
  const { apiFetch } = useAdmin()
  const { t } = useAdminLanguage()
  const [data, setData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = async () => {
    setIsLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/admin/dashboard')
      if (!res.ok) { setError(t('dashboard.failedToLoad')); return }
      setData(await res.json())
      setLastRefresh(new Date())
    } catch {
      setError(t('dashboard.networkError'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (n: number) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n)

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 text-sm mb-3">{error}</p>
        <button onClick={load} className="px-4 py-2 rounded-lg bg-black text-white text-sm">{t('dashboard.retry')}</button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('dashboard.title')}</h1>
          {lastRefresh && (
            <p className="text-xs text-gray-400 mt-0.5">
              {t('dashboard.lastUpdated', { time: lastRefresh.toLocaleTimeString('en-GB') })}
            </p>
          )}
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors border border-gray-200"
        >
          <RefreshCw className="h-4 w-4" />
          {t('dashboard.refresh')}
        </button>
      </div>

      {/* Revenue stats */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('dashboard.revenue')}</h2>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <RevenueCard label={t('dashboard.today')}     value={fmt(data.revenue.today)}     icon={<TrendingUp className="h-4 w-4" />} />
          <RevenueCard label={t('dashboard.thisWeek')}  value={fmt(data.revenue.thisWeek)}  icon={<TrendingUp className="h-4 w-4" />} accent />
          <RevenueCard label={t('dashboard.thisMonth')} value={fmt(data.revenue.thisMonth)} icon={<TrendingUp className="h-4 w-4" />} />
          <RevenueCard label={t('dashboard.allTime')}   value={fmt(data.revenue.allTime)}   icon={<TrendingUp className="h-4 w-4" />} />
        </div>
      </div>

      {/* Order stats */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('dashboard.orders')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <OrderCard label={t('dashboard.paid')}        value={data.orders.paid}           icon={<CheckCircle2 className="h-5 w-5 text-green-600" />} bg="bg-green-50"  border="border-green-100" />
          <OrderCard label={t('dashboard.failed')}      value={data.orders.failed}         icon={<XCircle      className="h-5 w-5 text-red-500" />}   bg="bg-red-50"    border="border-red-100" />
          <OrderCard label={t('dashboard.inProgress')}  value={data.orders.active}         icon={<Clock        className="h-5 w-5 text-amber-500" />} bg="bg-amber-50"  border="border-amber-100" />
          <OrderCard label={t('dashboard.successRate')} value={`${data.successRate}%`}     icon={<Activity     className="h-5 w-5 text-blue-600" />}  bg="bg-blue-50"   border="border-blue-100" />
        </div>
      </div>

      {/* Bottom grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent orders */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-gray-400" />
              <span className="font-medium text-sm text-gray-900">{t('dashboard.recentOrders')}</span>
            </div>
            <Link
              href="/admin/orders"
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors"
            >
              {t('dashboard.viewAll')} <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {data.recentOrders.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">{t('dashboard.noPaidOrders')}</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {data.recentOrders.map((order, i) => {
                const style = STATUS_STYLE[order.status] || STATUS_STYLE.pending
                const name = order.customer?.firstName
                  ? `${order.customer.firstName} ${order.customer.lastName || ''}`.trim()
                  : order.customer?.email || '—'
                return (
                  <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className={`h-2 w-2 rounded-full flex-shrink-0 ${style.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                      <p className="text-xs text-gray-400">{fmtDate(order.created_at)}</p>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                      {fmt(order.amount)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Avg order value */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <CreditCard className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">{t('dashboard.avgOrderValue')}</span>
            </div>
            <p className="text-3xl font-semibold text-gray-900">{fmt(data.avgOrderValue)}</p>
            <p className="text-xs text-gray-400 mt-1">{t('dashboard.acrossOrders', { count: data.orders.paid })}</p>
          </div>

          {/* Order status breakdown */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">{t('dashboard.statusBreakdown')}</span>
            </div>
            <div className="space-y-2">
              {Object.entries(STATUS_STYLE)
                .filter(([key]) => (data.orders[key] || 0) > 0)
                .map(([key, style]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${style.color}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                      {t(`status.${key}`)}
                    </span>
                    <span className="text-sm font-medium text-gray-700">{data.orders[key] || 0}</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Gift cards */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">{t('dashboard.giftCards')}</span>
              </div>
              <Link href="/admin/gift-cards" className="text-xs text-gray-400 hover:text-gray-700">
                {t('dashboard.manage')}
              </Link>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">{t('status.active')}</span>
                <span className="text-sm font-semibold text-gray-900">{data.giftCards.active}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">{t('dashboard.totalIssued')}</span>
                <span className="text-sm font-semibold text-gray-900">{fmt(data.giftCards.totalAmountIssued)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RevenueCard({
  label, value, icon, accent,
}: {
  label: string; value: string; icon: React.ReactNode; accent?: boolean
}) {
  return (
    <div className={`rounded-2xl border shadow-sm p-5 ${accent ? 'bg-black border-black text-white' : 'bg-white border-gray-200'}`}>
      <div className={`inline-flex items-center justify-center h-8 w-8 rounded-xl mb-4 ${accent ? 'bg-white/10' : 'bg-gray-100'}`}>
        <span className={accent ? 'text-white' : 'text-gray-500'}>{icon}</span>
      </div>
      <p className={`text-2xl font-bold ${accent ? 'text-white' : 'text-gray-900'}`}>{value}</p>
      <p className={`text-xs mt-1 ${accent ? 'text-white/60' : 'text-gray-400'}`}>{label}</p>
    </div>
  )
}

function OrderCard({
  label, value, icon, bg, border,
}: {
  label: string; value: string | number; icon: React.ReactNode; bg: string; border: string
}) {
  return (
    <div className={`rounded-2xl border shadow-sm p-5 bg-white ${border}`}>
      <div className={`inline-flex items-center justify-center h-9 w-9 rounded-xl mb-3 ${bg}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
    </div>
  )
}
