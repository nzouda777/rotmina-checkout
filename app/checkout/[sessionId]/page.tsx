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
  const { t } = useLanguage()
  
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
    // Standard redirection format requested by user
    const baseUrl = window.location.origin
    const targetUrl = `${baseUrl}/checkout/success?session=${sessionId}&confirmation=${confirmationCode}`
    window.location.href = targetUrl
  }

  const handlePaymentError = (errorMessage: string) => {
    const baseUrl = window.location.origin
    window.location.href = `${baseUrl}/checkout/s=error`
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
          <p className="text-muted-foreground">{t('checkout.loadingCheckout')}</p>
        </div>
      </div>
    )
  }

  if (error && !session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground mb-2">{t('checkout.checkoutError')}</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return null
  }

  const giftCardAmount = appliedGiftCard?.appliedAmount || 0

  return (
    <div className="min-h-screen bg-background">
      <CheckoutHeader shopName={session.shop} />
      
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
          {/* Left Column - Forms */}
          <div className="flex-1 order-2 lg:order-1">
            {/* Breadcrumb */}
            <nav className="flex items-center rtl:flex-row-reverse rtl:justify-end gap-2 text-sm mb-8">
              <span className="text-muted-foreground">{t('checkout.cart')}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <span className={step === 'information' ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                {t('checkout.information')}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <span className={step === 'payment' ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                {t('checkout.payment')}
              </span>
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
                  total={session.cart.total}
                  currency={session.cart.currency}
                  shopDomain={session.shop}
                  onBack={() => setStep('information')}
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                  onProcessing={() => setStep('processing')}
                  giftCardId={appliedGiftCard?.id}
                  giftCardCode={appliedGiftCard?.code}
                  giftCardAmount={giftCardAmount}
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
                cartData={session.cart}
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
