'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CheckoutHeader } from '@/components/checkout/checkout-header'
import { OrderSummary } from '@/components/checkout/order-summary'
import { CustomerForm } from '@/components/checkout/customer-form'
import { PaymentForm } from '@/components/checkout/payment-form'
import { GiftCardForm } from '@/components/checkout/gift-card-form'
import { CheckoutFooter } from '@/components/checkout/checkout-footer'
import type { PaymentSession, CustomerInfo } from '@/lib/types'
import { useLanguage } from '@/lib/language-context'

// console.log('CheckoutPage module loaded');

type CheckoutStep = 'information' | 'payment' | 'processing'

interface AppliedGiftCard {
  id: string
  code: string
  balance: number
  appliedAmount: number
}

export default function CheckoutPage() {
  // console.log('CheckoutPage rendering START');
  
  const params = useParams()
  const router = useRouter()
  const sessionId = params?.sessionId as string
  const { t, lang, dir } = useLanguage()
  
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
        throw new Error('Session not found')
      }
      const data = await response.json()
      console.log('Session data loaded:', data);
      setSession(data)
      if (data.customer) {
        setCustomerInfo(data.customer)
      }
    } catch (err) {
      console.error('Fetch session error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load checkout')
    } finally {
      setLoading(false) // ← toujours appelé, succès ou erreur
    }
  }

  fetchSession()
}, [sessionId])

  const handleCustomerSubmit = (info: CustomerInfo) => {
    setCustomerInfo(info)
    setStep('payment')
  }

  const handlePaymentSuccess = (
    confirmationCode: string, 
    shopifyOrderUrl?: string,
    generatedGiftCards?: { code: string; amount: number }[],
    giftCardRemainingBalance?: number,
    usedGiftCardCode?: string
  ) => {
    const storeUrl = process.env.NEXT_PUBLIC_STORE_URL || 'https://rotmina.co'
    window.location.href = `${storeUrl}/pages/success?session=${sessionId}&confirmation=${confirmationCode}&language=${lang}`
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

  const shippingFeeAmount = lang === 'en' && session
    ? Math.round(session.cart.total * 0.20 * 100) / 100
    : 0

  const adjustedCartData = shippingFeeAmount > 0
    ? {
        ...session.cart,
        shipping: session.cart.shipping + shippingFeeAmount,
        total: session.cart.total + shippingFeeAmount,
      }
    : session.cart

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
              />
            )}

            {step === 'payment' && (
              <div className="space-y-6">
                {/* Gift Card Section */}
                <GiftCardForm
                  currency={session.cart.currency}
                  onApply={handleGiftCardApply}
                  onRemove={handleGiftCardRemove}
                  appliedGiftCard={appliedGiftCard}
                  orderTotal={session.cart.total}
                />
 
                {/* Divider */}
                <div className="border-t border-border" />

                {/* Payment Form */}
                <PaymentForm
                  sessionId={sessionId}
                  customerInfo={customerInfo}
                  total={adjustedCartData.total}
                  currency={session.cart.currency}
                  shopDomain={session.shop}
                  onBack={() => setStep('information')}
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                  onProcessing={() => setStep('processing')}
                  giftCardId={appliedGiftCard?.id}
                  giftCardCode={appliedGiftCard?.code}
                  giftCardAmount={giftCardAmount}
                  shippingFeeAmount={shippingFeeAmount}
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
