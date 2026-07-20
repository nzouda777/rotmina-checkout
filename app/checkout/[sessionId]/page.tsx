'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CheckoutHeader } from '@/components/checkout/checkout-header'
import { OrderSummary } from '@/components/checkout/order-summary'
import { CustomerForm } from '@/components/checkout/customer-form'
import { PaymentForm } from '@/components/checkout/payment-form'
import { GiftCardForm } from '@/components/checkout/gift-card-form'
import { CheckoutFooter } from '@/components/checkout/checkout-footer'
import type { PaymentSession, CustomerInfo, AppliedCoupon } from '@/lib/types'
import { useLanguage } from '@/lib/language-context'
import { storeUrl } from '@/lib/store-url'

// console.log('CheckoutPage module loaded');

type CheckoutStep = 'information' | 'payment' | 'processing'

interface AppliedGiftCard {
  id: string
  code: string
  balance: number | null
  appliedAmount: number
  discountType: 'amount' | 'percentage'
  discountValue: number | null
}

export default function CheckoutPage() {
  // console.log('CheckoutPage rendering START');
  
  const params = useParams()
  const router = useRouter()
  const sessionId = params?.sessionId as string
  const { t, lang, dir, currency, setCurrency } = useLanguage()
  
  console.log('Session ID from useParams:', sessionId);

  const [session, setSession] = useState<PaymentSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<CheckoutStep>('information')
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    email: '',
    firstName: '',
    lastName: '',
    address: '',
    city: '',
    postalCode: '',
    country: 'Israel',
    phone: '',
    nationalId: '',
  })

  // Gift card state
  const [appliedGiftCard, setAppliedGiftCard] = useState<AppliedGiftCard | null>(null)

  // Coupon code state
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null)

  // Tax state for English checkout
  const [taxRules, setTaxRules] = useState<{ country: string; tax_rate: number }[]>([])
  const [selectedCountry, setSelectedCountry] = useState<string>('United States')
  const [applyingTax, setApplyingTax] = useState(false)

  // Tranzila charges directly in whatever currency the customer selects
  // (ILS/USD/EUR/GBP/CAD/CHF — see lib/currency.ts), so there is no cosmetic
  // display-only conversion anymore; displayRate always stays 1 and every
  // currency switch below triggers a real session conversion.
  const [displayRate, setDisplayRate] = useState(1)

  // Fetch tax rules for English checkout live preview
  useEffect(() => {
    if (lang !== 'en') return
    fetch('/api/checkout/tax-rules')
      .then((r) => r.json())
      .then((d) => { if (d.rules) setTaxRules(d.rules) })
      .catch(() => {})
  }, [lang])

  useEffect(() => {
  console.log('EFFECT MOUNT - sessionId:', sessionId);

  // Attendre que sessionId soit disponible
  if (!sessionId) {
    console.warn('sessionId not yet available, skipping fetch');
    return; // Ne pas toucher à loading ici — un second rendu va arriver
  }

  async function fetchSession() {
    console.log('FETCHING FROM API:', `/api/checkout/session?id=${sessionId}`);
    try {
      const response = await fetch(`/api/checkout/session?id=${sessionId}`)
      if (!response.ok) {
        // Session doesn't exist or server error — redirect to store (same language)
        window.location.href = storeUrl(lang, '', currency)
        return
      }
      const data = await response.json()
      console.log('Session data loaded:', data);
      console.log('[DISCOUNT] session.cart.shopify_discount:', JSON.stringify(data.cart?.shopify_discount));

      // If the session was previously failed, reset it so the user can retry
      if (data.status === 'failed') {
        try {
          await fetch('/api/checkout/session/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          })
          data.status = 'pending'
        } catch {
          // Reset failed — still show the checkout, user can try again
        }
      }

      // Fallback discount detection: Shopify applies cart-level discounts to the
      // cart total/subtotal WITHOUT reducing individual item prices. So if
      // sum(item.price × qty) > cart.subtotal, the difference is the discount.
      // This catches sessions created before explicit shopify_discount detection was deployed.
      if (data.cart && !data.cart.shopify_discount) {
        const itemsTotal = (data.cart.items || []).reduce((sum: number, item: any) => {
          return sum + (item.price || 0) * (item.quantity || 1)
        }, 0)
        const impliedDiscount = Math.round((itemsTotal - (data.cart.subtotal || 0)) * 100) / 100
        console.log('[DISCOUNT] fallback check: itemsTotal=', itemsTotal, 'subtotal=', data.cart.subtotal, 'implied=', impliedDiscount)
        if (impliedDiscount > 0.5) {
          data.cart.shopify_discount = { amount: impliedDiscount, codes: [] }
          console.log('[DISCOUNT] fallback shopify_discount set:', impliedDiscount)
        }
      }

      setSession(data)
      if (data.customer) {
        setCustomerInfo(data.customer)
      }
    } catch (err) {
      console.error('Fetch session error:', err)
      // Network error — redirect to store (same language) rather than showing
      // a confusing "payment failed" popup
      window.location.href = storeUrl(lang, '', currency)
    } finally {
      setLoading(false)
    }
  }

  fetchSession()
}, [sessionId])

  // When the session loads (or the language changes), the currency defaults to
  // the checkout language: USD for English, ILS for Hebrew. If the session was
  // created in another currency (including legacy EUR carts), the mismatch
  // triggers the conversion PATCH below before any payment can start.
  useEffect(() => {
    if (!session) return
    setCurrency(lang === 'he' ? 'ILS' : 'USD')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, lang])

  // Keep the session's stored language in sync with whatever language the
  // customer is actually checking out in, so the post-payment receipt and
  // confirmation email (sent server-side, possibly from an async callback)
  // are sent in the right language rather than defaulting to Hebrew.
  useEffect(() => {
    if (!sessionId) return
    fetch('/api/checkout/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'set-language', sessionId, lang }),
    }).catch(() => {})
  }, [lang, sessionId])

  // When the user picks a different currency, PATCH the session so the real
  // cart/charge amount actually converts — Tranzila charges directly in
  // whatever currency the customer selects (see lib/currency.ts).
  useEffect(() => {
    if (!session || !sessionId) return
    const realCurrency = ((session.cart?.currency as string) || 'ILS').toUpperCase()
    if (realCurrency === currency) {
      setDisplayRate(1)
      return
    }

    let cancelled = false
    fetch('/api/checkout/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, targetCurrency: currency, lang }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setSession(data)
        setDisplayRate(1)
        // Applied amounts were computed against the previous currency —
        // drop them so the customer re-applies and gets converted values.
        setAppliedGiftCard(null)
        setAppliedCoupon(null)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [currency, sessionId])

  const handleCustomerSubmit = async (info: CustomerInfo) => {
    setCustomerInfo(info)

    // For English checkout, apply country-based tax to the session before payment
    if (lang === 'en' && sessionId) {
      setApplyingTax(true)
      try {
        const res = await fetch('/api/checkout/session', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'apply-tax', sessionId, country: info.country }),
        })
        if (res.ok) {
          const data = await res.json()
          setSession(data)
        }
      } catch {
        // Non-blocking: proceed to payment even if tax PATCH fails
      } finally {
        setApplyingTax(false)
      }
    }

    setStep('payment')
  }

  const handlePaymentSuccess = (
    confirmationCode: string,
    shopifyOrderUrl?: string,
    generatedGiftCards?: { code: string; amount: number }[],
    giftCardRemainingBalance?: number,
    usedGiftCardCode?: string
  ) => {
    const baseUrl = window.location.origin
    let url = `${baseUrl}/checkout/success?session=${sessionId}&confirmation=${confirmationCode}&language=${lang}`
    if (generatedGiftCards && generatedGiftCards.length > 0) {
      url += `&gift_cards=${generatedGiftCards.map(gc => gc.code).join(',')}`
    }
    if (usedGiftCardCode) {
      url += `&used_gc=${encodeURIComponent(usedGiftCardCode)}`
    }
    if (giftCardRemainingBalance !== undefined) {
      url += `&gc_remaining=${giftCardRemainingBalance}`
    }
    window.location.href = url
  }

  const handlePaymentError = (errorMessage: string) => {
    const baseUrl = window.location.origin
    window.location.href = `${baseUrl}/checkout/error?session=${sessionId}&language=${lang}`
  }

  const handleGiftCardApply = (giftCard: AppliedGiftCard) => {
    setAppliedGiftCard(giftCard)
  }

  const handleGiftCardRemove = () => {
    setAppliedGiftCard(null)
  }

  const handleCouponApply = (coupon: AppliedCoupon) => {
    setAppliedCoupon(coupon)
  }

  const handleCouponRemove = () => {
    setAppliedCoupon(null)
  }

  const [removingItemId, setRemovingItemId] = useState<string | null>(null)

  const handleRemoveItem = async (itemId: string) => {
    if (!sessionId || removingItemId) return
    setRemovingItemId(itemId)
    try {
      const res = await fetch('/api/checkout/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'remove-item', sessionId, itemId }),
      })
      if (res.ok) {
        const data = await res.json()
        setSession(data)
        // Applied amounts were computed against the previous cart total —
        // drop them so the customer re-applies and gets recalculated values.
        setAppliedGiftCard(null)
        setAppliedCoupon(null)
      }
    } catch {
      // Non-blocking: leave the cart as-is if the request fails
    } finally {
      setRemovingItemId(null)
    }
  }

  console.log('Render state - Loading:', loading, 'Error:', error, 'Session:', !!session);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir={dir}>
        <div className="flex flex-col items-center gap-4" dir={dir}>
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
          <p className="text-muted-foreground" dir={dir}>{t('checkout.loadingCheckout')}</p>
        </div>
      </div>
    )
  }

  if (error && !session) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center sm:bg-black/60 px-4" dir={dir}>
        {/* Mobile background image */}
        <img
          src="/checkout/error-bg.webp"
          alt=""
          className="sm:hidden absolute inset-0 h-full w-full object-cover object-center"
        />
        <div className="sm:hidden absolute inset-0 bg-black/30" />

        <div
          className="relative flex w-full overflow-hidden bg-white shadow-2xl"
          style={{ maxWidth: 560, borderRadius: 2 }}
        >
          {/* Left: product image - desktop only */}
          <div className="relative hidden sm:block" style={{ width: '44%', minHeight: 380, flexShrink: 0 }}>
            <img
              src="/checkout/error-bg.webp"
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
          </div>

          {/* Right: content */}
          <div className="flex flex-1 flex-col items-center justify-center bg-white px-10 py-10 text-center relative">
            {/* Close button */}
            <button
              onClick={() => router.back()}
              aria-label="Close"
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>

            {/* Title */}
            <h1
              className="text-[2.4rem] leading-[1.1] text-gray-900 mb-4"
              style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic' }}
            >
              {t('errorModal.title')}
            </h1>

            {/* Body */}
            <p className="text-[0.8rem] text-gray-500 leading-relaxed mb-6" style={{ maxWidth: 195 }}>
              {t('errorModal.body')}
            </p>

            {/* CTA */}
            <button
              onClick={() => router.back()}
              className="text-[0.82rem] text-gray-900 underline underline-offset-2 hover:opacity-60 transition-opacity"
            >
              {t('errorModal.cta')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!session) {
    return null
  }

  const giftCardAmount = appliedGiftCard?.appliedAmount || 0
  const couponAmount = appliedCoupon?.appliedAmount || 0

  const adjustedCartData = session.cart

  const liveTaxRule = lang === 'en'
    ? taxRules.find((r) => r.country === selectedCountry)
    : undefined
  const GIFT_CARD_KEYWORDS = ['gift card', 'carte cadeau', 'גיפט קארד', 'כרטיס מתנה']
  const taxableItems = (adjustedCartData.items || []).filter(
    (item: any) => !GIFT_CARD_KEYWORDS.some((kw) => (item.title || '').toLowerCase().includes(kw))
  )
  const taxableSubtotal = taxableItems.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0)
  const liveTax = liveTaxRule ? Math.round(taxableSubtotal * (liveTaxRule.tax_rate / 100) * 100) / 100 : undefined
  // Once the session has been patched (step === 'payment'), tax is already in the cart
  const taxOverride = step === 'information' && lang === 'en' ? liveTax : undefined

  return (
    <div className="min-h-screen bg-background">
      <CheckoutHeader shopName={session.shop} />
      
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
          {/* Left Column - Forms */}
          <div className="flex-1 order-2 lg:order-1">
            {/* Breadcrumb */}
            <nav className="flex items-center justify-end rtl:flex-row-reverse gap-2 text-sm mb-8">
              {lang === 'he' ? (
                <>
                  <span className={step === 'payment' ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                    {t('checkout.payment')}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground rotate-180" />
                  <span className={step === 'information' ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                    {t('checkout.information')}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground rotate-180" />
                  <span className="text-muted-foreground">{t('checkout.cart')}</span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">{t('checkout.cart')}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <span className={step === 'information' ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                    {t('checkout.information')}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <span className={step === 'payment' ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                    {t('checkout.payment')}
                  </span>
                </>
              )}
            </nav>

            {error && (
              <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {step === 'information' && (
              <CustomerForm
                initialData={customerInfo}
                onSubmit={handleCustomerSubmit}
                onCountryChange={lang === 'en' ? setSelectedCountry : undefined}
              />
            )}

            {step === 'payment' && (
              <div className="space-y-6">
                {/* Gift Card Section */}
                <GiftCardForm
                  currency={session.cart.currency}
                  displayCurrency={currency}
                  displayRate={displayRate}
                  onApply={handleGiftCardApply}
                  onRemove={handleGiftCardRemove}
                  appliedGiftCard={appliedGiftCard}
                  orderTotal={Math.max(adjustedCartData.total - couponAmount, 0)}
                />

                {/* Divider */}
                <div className="border-t border-border" />

                {/* Payment Form (coupon field is rendered inside) */}
                <PaymentForm
                  sessionId={sessionId}
                  customerInfo={customerInfo}
                  total={adjustedCartData.total}
                  currency={session.cart.currency}
                  displayCurrency={currency}
                  displayRate={displayRate}
                  shopDomain={session.shop}
                  onBack={() => setStep('information')}
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                  onProcessing={() => setStep('processing')}
                  giftCardId={appliedGiftCard?.id}
                  giftCardCode={appliedGiftCard?.code}
                  giftCardAmount={giftCardAmount}
                  couponCode={appliedCoupon?.code}
                  couponAmount={couponAmount}
                  shopifyDiscount={session.cart.shopify_discount}
                  appliedCoupon={appliedCoupon}
                  onCouponApply={handleCouponApply}
                  onCouponRemove={handleCouponRemove}
                />
              </div>
            )}

            {step === 'processing' && (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-muted border-t-foreground mb-4" />
                <p className="text-lg font-medium text-foreground">{t('checkout.processingPayment')}</p>
                <p className="text-sm text-muted-foreground mt-2">{t('checkout.doNotClose')}</p>
              </div>
            )}
          </div>

          {/* Right Column - Order Summary */}
          <div className="w-full lg:w-[400px] order-1 lg:order-2">
            <div className="lg:sticky lg:top-8">
              <OrderSummary
                cartData={adjustedCartData}
                giftCardAmount={giftCardAmount}
                giftCardCode={appliedGiftCard?.code}
                couponAmount={couponAmount}
                couponCode={appliedCoupon?.code}
                taxOverride={taxOverride}
                displayCurrency={currency}
                displayRate={displayRate}
                onRemoveItem={step !== 'processing' ? handleRemoveItem : undefined}
                removingItemId={removingItemId}
              />
            </div>
          </div>
        </div>
      </main>

      <CheckoutFooter />
    </div>
  )
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}
