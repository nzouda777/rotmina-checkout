'use client'

import { useState } from 'react'
import { ArrowLeft, CreditCard, Lock, Shield, Info } from 'lucide-react'
import type { CustomerInfo } from '@/lib/types'
import { redirect } from 'next/dist/server/api-utils'
import Image from 'next/image'
import { useLanguage } from '@/lib/language-context'
import { TERMS_TEXT_EN, TERMS_TEXT_HE } from '@/lib/terms'

interface PaymentFormProps {
  sessionId: string
  customerInfo: CustomerInfo
  total: number
  currency: string
  onBack: () => void
  onSuccess: (
    confirmationCode: string,
    shopifyOrderUrl?: string,
    generatedGiftCards?: { code: string; amount: number }[],
    giftCardRemainingBalance?: number,
    usedGiftCardCode?: string
  ) => void
  onError: (error: string) => void
  onProcessing: () => void
  giftCardId?: string
  giftCardCode?: string
  giftCardAmount?: number
}

/**
 * Calculate max installments based on the amount to be charged
 * (remaining after gift card deduction).
 */
function getMaxInstallments(amount: number, currency: string): number {
  let rate = 1.0
  const normalizedCurrency = currency.toUpperCase()
  if (normalizedCurrency === 'USD') rate = 3.7
  else if (normalizedCurrency === 'EUR') rate = 4.0
  else if (normalizedCurrency === 'GBP') rate = 4.7
  
  const amountInILS = amount * rate

  if (amountInILS < 500) return 1
  if (amountInILS >= 1500) return 6
  if (amountInILS >= 1300) return 4
  if (amountInILS >= 900) return 3
  return 2
}

export function PaymentForm({
  sessionId,
  customerInfo,
  total,
  currency,
  onBack,
  onSuccess,
  onError,
  onProcessing,
  giftCardId,
  giftCardCode,
  giftCardAmount = 0,
}: PaymentFormProps) {
  const [cardNumber, setCardNumber] = useState('')
  const [cardholderName, setCardholderName] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [cvv, setCvv] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [show3DS, setShow3DS] = useState(false)
  const [threeDSUrl, setThreeDSUrl] = useState('')
  const [installments, setInstallments] = useState(1)
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'bit'>('card')
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const { t, lang } = useLanguage()

  const close3DS = (source: string) => {
    console.log(`[PAYMENT-FORM] Closing 3DS modal (source: ${source})`)
    setShow3DS(false)
    setIsSubmitting(false)
  }

  // The amount charged to the credit card (after gift card deduction)
  const chargeAmount = Math.max(total - giftCardAmount, 0)

  const maxInstallments = getMaxInstallments(chargeAmount, currency)

  // Reset installments if max changed and current selection is invalid
  if (installments > maxInstallments) {
    setInstallments(1)
  }

  const formatCardNumber = (value: string) => {
    const digits = value.replace(/\D/g, '')
    const groups = digits.match(/.{1,4}/g)
    return groups ? groups.join(' ').substring(0, 19) : ''
  }

  const formatExpiryDate = (value: string) => {
    const digits = value.replace(/\D/g, '')
    if (digits.length >= 2) {
      return digits.substring(0, 2) + '/' + digits.substring(2, 4)
    }
    return digits
  }

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCardNumber(formatCardNumber(e.target.value))
    if (errors.cardNumber) setErrors((prev) => ({ ...prev, cardNumber: '' }))
  }

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setExpiryDate(formatExpiryDate(e.target.value))
    if (errors.expiryDate) setErrors((prev) => ({ ...prev, expiryDate: '' }))
  }

  const handleCvvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').substring(0, 4)
    setCvv(digits)
    if (errors.cvv) setErrors((prev) => ({ ...prev, cvv: '' }))
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!termsAccepted) {
      newErrors.terms = t('paymentForm.acceptTermsError')
    }

    if (paymentMethod !== 'bit') {
      const cardDigits = cardNumber.replace(/\s/g, '')
      // ... rest of validation for card

      if (!cardDigits || cardDigits.length < 13) {
        newErrors.cardNumber = t('paymentForm.invalidCardNumber')
      }

      if (!cardholderName.trim()) {
        newErrors.cardholderName = t('paymentForm.cardholderRequired')
      }

      if (!expiryDate || expiryDate.length < 5) {
        newErrors.expiryDate = t('paymentForm.invalidExpiry')
      } else {
        const [month, year] = expiryDate.split('/')
        const currentYear = new Date().getFullYear() % 100
        const currentMonth = new Date().getMonth() + 1
        if (
          parseInt(month) < 1 ||
          parseInt(month) > 12 ||
          parseInt(year) < currentYear ||
          (parseInt(year) === currentYear && parseInt(month) < currentMonth)
        ) {
          newErrors.expiryDate = t('paymentForm.cardExpired')
        }
      }

      if (!cvv || cvv.length < 3) {
        newErrors.cvv = t('paymentForm.invalidCvv')
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setIsSubmitting(true)

    const browserData = {
      java_enabled: navigator.javaEnabled() ? 1 : 0,
      language: navigator.language || 'en-US',
      color_depth: window.screen.colorDepth || 24,
      screen_height: window.screen.height || 1080,
      screen_width: window.screen.width || 1920,
      time_zone: new Date().getTimezoneOffset(),
      user_agent: navigator.userAgent,
      accept_header: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      window_size: '04',
    }

    try {
      const response = await fetch('/api/checkout/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          customerInfo,
          cardNumber: chargeAmount > 0 ? cardNumber.replace(/\s/g, '') : undefined,
          expiryDate: chargeAmount > 0 ? expiryDate : undefined,
          cvv: chargeAmount > 0 ? cvv : undefined,
          cardholderName: (chargeAmount > 0 && paymentMethod === 'card') ? cardholderName : undefined,
          browserData: (chargeAmount > 0 && paymentMethod === 'card') ? browserData : undefined,
          installments: paymentMethod === 'card' ? installments : 1,
          paymentMethod,
          // Gift card data
          giftCardId: giftCardId || undefined,
          giftCardCode: giftCardCode || undefined,
          giftCardAmount: giftCardAmount || undefined,
        }),
      })

      const result = await response.json()
      console.log('[PAYMENT-FORM] Response result:', JSON.stringify(result))
      
      // 3DS challenge required — show in iframe (same window)
      if (result.requires3DS && result.redirectUrl) {
        console.log('[PAYMENT-FORM] 3DS Required. Showing modal for:', result.redirectUrl)
        setThreeDSUrl(result.redirectUrl)
        setShow3DS(true)

        console.log("show3DS",show3DS)
        console.log("threeDSUrl", result.redirectUrl)
        // window.location.href = result.redirectUrl

        // Listen for postMessage from the iframe
        const messageHandler = async (event: MessageEvent) => {
          // Debug everything coming from the iframe
          console.log('[3DS DEBUG] Raw MessageEvent received:', event.data, 'from origin:', event.origin)
          
          let eventData = event.data;
          try {
             if (typeof eventData === 'string') eventData = JSON.parse(eventData);
          } catch(e) {}

          // Security: Check if it's our message type OR Tranzila's
          if (eventData?.type !== '3DS_COMPLETE' && !eventData?.track_id) return
          
          // Verify sessionId to avoid cross-session issues
          if (eventData.sessionId && eventData.sessionId !== sessionId) {
            console.log('[3DS] Received message for different session, ignoring')
            return
          }
          
          console.log('[3DS] Received matching postMessage from iframe:', eventData)
          window.removeEventListener('message', messageHandler)
          if (statusPollInterval) clearInterval(statusPollInterval)

          // The callback processed the complete API call and created the order
          try {
            const statusRes = await fetch(`/api/checkout/session?id=${sessionId}`)
            if (statusRes.ok) {
              const sessionData = await statusRes.json()
              if (sessionData.status === 'paid') {
                close3DS('postMessage Success')
                onSuccess(
                  sessionData.tranzila_transaction_id || 'confirmed',
                  sessionData.raw_response?.shopifyOrderUrl,
                )
                return
              }
            }
          } catch (e) {
            console.error('[3DS] Error fetching session after postMessage:', e)
          }
          
          close3DS('postMessage Finish')
          if (eventData.success) {
            // Callback said success but session isn't paid yet — wait and check
            setTimeout(async () => {
              try {
                const statusRes = await fetch(`/api/checkout/session?id=${sessionId}`)
                if (statusRes.ok) {
                  const sessionData = await statusRes.json()
                  if (sessionData.status === 'paid') {
                    onSuccess(
                      sessionData.tranzila_transaction_id || 'confirmed',
                      sessionData.raw_response?.shopifyOrderUrl,
                    )
                    return
                  }
                  // Session marked as failed — show the error from the session
                  if (sessionData.status === 'failed') {
                    const errorMsg = sessionData.error_message || t('paymentForm.paymentDeclinedByBank')
                    setPaymentError(errorMsg)
                    return
                  }
                }
              } catch {}
              setPaymentError(t('paymentForm.paymentVerificationFailed'))
            }, 2000)
          } else {
            // Extract the error message from the postMessage data
            const errorMsg = eventData.errorMessage || eventData.error || t('paymentForm.paymentDeclinedGeneric')
            setPaymentError(errorMsg)
          }
        }

        window.addEventListener('message', messageHandler)

        // Fallback: poll session status only (NOT 3ds-complete) 
        // We add a delay before starting the first poll to allow 3DS challenge to initialize
        let statusPollInterval: NodeJS.Timeout | null = null;
        
        setTimeout(() => {
          if (!setShow3DS) return; // Component might be unmounted

          statusPollInterval = setInterval(async () => {
            console.log(`[POLL] Fallback checking ${paymentMethod.toUpperCase()} completion...`)
            try {
              const pollUrl = paymentMethod === 'bit' 
                ? `/api/checkout/session?id=${sessionId}`
                : `/api/checkout/3ds-complete`
              
              const pollOptions = paymentMethod === 'bit'
                ? { method: 'GET' }
                : { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, trackId: result.trackId })
                  }

              const statusRes = await fetch(pollUrl, pollOptions as any)
              
              if (statusRes.ok) {
                const data = await statusRes.json()
                
                const isFinalized = paymentMethod === 'bit' 
                  ? data.status === 'paid'
                  : (data.success || data.alreadyProcessed)

                if (isFinalized) {
                  console.log(`[POLL] ${paymentMethod.toUpperCase()} success detected via poll`)
                  if (statusPollInterval) clearInterval(statusPollInterval as any)
                  window.removeEventListener('message', messageHandler)
                  
                  const finalSession = paymentMethod === 'bit' ? data : await (await fetch(`/api/checkout/session?id=${sessionId}`)).json()
                  
                  close3DS('Poll Success')
                  onSuccess(
                    finalSession.tranzila_transaction_id || 'confirmed',
                    finalSession.raw_response?.shopifyOrderUrl,
                  )
                } else if (paymentMethod !== 'bit' && !data.pending) {
                  if (statusPollInterval) clearInterval(statusPollInterval as any)
                  window.removeEventListener('message', messageHandler)
                  close3DS('Poll Failure')
                  setPaymentError(data.error || t('paymentForm.paymentDeclinedGeneric'))
                }
              }
            } catch (e) {
              console.error('[3DS] Error verifying completion:', e)
            }
          }, 5000) // Check every 5 seconds
        }, 30000) // Start polling only after 10 seconds to avoid race conditions with initial load

        return
      }

      if (result.success) {
        onSuccess(
          result.confirmationCode,
          result.shopifyOrderUrl,
          result.generatedGiftCards,
          result.giftCardRemainingBalance,
          giftCardCode
        )
      } else {
        setPaymentError(result.error || t('paymentForm.paymentFailed'))
      }
    } catch {
      setPaymentError(t('paymentForm.paymentProcessingFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: currency,
    }).format(amount)
  }

  const getCardType = (number: string): string => {
    const cleaned = number.replace(/\s/g, '')
    if (/^4/.test(cleaned)) return 'visa'
    if (/^5[1-5]/.test(cleaned)) return 'mastercard'
    if (/^3[47]/.test(cleaned)) return 'amex'
    if (/^6(?:011|5)/.test(cleaned)) return 'discover'
    return 'generic'
  }

  // Per-installment amount
  const perInstallment = installments > 1 ? chargeAmount / installments : chargeAmount

  return (
    <div className="space-y-6">
      {/* Contact Summary */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex justify-between items-start">
          <div className="space-y-2 text-sm">
            <div className="flex gap-8">
              <span className="text-muted-foreground w-20">{t('paymentForm.contactLabel')}</span>
              <span className="text-foreground">{customerInfo.email}</span>
            </div>
            <div className="flex gap-8">
              <span className="text-muted-foreground w-20">{t('paymentForm.shipTo')}</span>
              <span className="text-foreground">
                {customerInfo.address}, {customerInfo.city}, {customerInfo.country}
              </span>
            </div>
          </div>
          <button
            onClick={onBack}
            className="text-sm text-foreground underline hover:no-underline"
          >
            {t('paymentForm.change')}
          </button>
        </div>
      </div>

      {/* Gift Card Applied Notice */}
      {giftCardAmount > 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50/50 dark:border-green-800/50 dark:bg-green-900/10 px-4 py-3">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="text-green-700 dark:text-green-300 font-medium">
                Gift card ****{giftCardCode} applied: {formatPrice(giftCardAmount)}
              </p>
              {chargeAmount > 0 ? (
                <p className="text-green-600/80 dark:text-green-400/80 mt-1">
                  {t('paymentForm.remainingCharged').replace('{amount}', formatPrice(chargeAmount))}
                  {maxInstallments > 1 && (
                    <> {t('paymentForm.canSplitInstallments').replace('{max}', String(maxInstallments))}</>
                  )}
                </p>
              ) : (
                <p className="text-green-600/80 dark:text-green-400/80 mt-1">
                  {t('paymentForm.giftCardCoversAll')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Form - only show if credit card charge needed */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {chargeAmount > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">{t('paymentForm.paymentTitle')}</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {t('paymentForm.secureEncrypted')}
            </p>

            {/* Payment Method Selector */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <button
                type="button"
                onClick={() => setPaymentMethod('card')}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  paymentMethod === 'card'
                    ? 'border-foreground bg-foreground/5 shadow-sm'
                    : 'border-border bg-background hover:border-muted-foreground/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <CreditCard className={`h-5 w-5 ${paymentMethod === 'card' ? 'text-foreground' : 'text-muted-foreground'}`} />
                  <span className={`text-sm font-semibold ${paymentMethod === 'card' ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {t('paymentForm.creditCard')}
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('bit')}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  paymentMethod === 'bit'
                    ? 'border-[#2b5686] bg-gradient-to-b from-[#2b5686]/10 to-[#2eb3b8]/10 shadow-sm'
                    : 'border-border bg-background hover:border-muted-foreground/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="relative h-6 flex items-center justify-center">
                     <Image 
                       src="/bit.png" 
                       alt="Bit" 
                       width={50} 
                       height={30} 
                       className={`${paymentMethod === 'bit' ? 'opacity-100' : 'opacity-50 grayscale'} transition-all`}
                       style={{ objectFit: 'contain' }}
                     />
                  </div>
                </div>
              </button>
            </div>

            {paymentMethod === 'card' ? (
              <div className="rounded-lg border border-border overflow-hidden">
              {/* Card Header */}
              <div className="bg-muted/50 px-4 py-3 flex items-center justify-between border-b border-border">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-foreground" />
                  <span className="text-sm font-medium text-foreground">{t('paymentForm.creditCardLower')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CardBrand type="visa" />
                  <CardBrand type="mastercard" />
                  <CardBrand type="amex" />
                  <CardBrand type="discover" />
                  <CardBrand type="diners" />

                </div>
              </div>

              {/* Card Fields */}
              <div className="p-4 space-y-3 bg-background">
                <div>
                  <label htmlFor="cardNumber" className="sr-only">{t('paymentForm.cardNumber')}</label>
                  <div className="relative">
                    <input
                      type="text"
                      id="cardNumber"
                      value={cardNumber}
                      onChange={handleCardNumberChange}
                      placeholder={t('paymentForm.cardNumber')}
                      maxLength={19}
                      className={`w-full px-4 py-3 pr-12 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                        errors.cardNumber ? 'border-destructive' : 'border-input'
                      }`}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <CardBrand type={getCardType(cardNumber)} />
                    </div>
                  </div>
                  {errors.cardNumber && (
                    <p className="mt-1 text-sm text-destructive">{errors.cardNumber}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="cardholderName" className="sr-only">{t('paymentForm.cardholderName')}</label>
                  <input
                    type="text"
                    id="cardholderName"
                    value={cardholderName}
                    onChange={(e) => {
                      setCardholderName(e.target.value)
                      if (errors.cardholderName) setErrors((prev) => ({ ...prev, cardholderName: '' }))
                    }}
                    placeholder={t('paymentForm.cardholderName')}
                    className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                      errors.cardholderName ? 'border-destructive' : 'border-input'
                    }`}
                  />
                  {errors.cardholderName && (
                    <p className="mt-1 text-sm text-destructive">{errors.cardholderName}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="expiryDate" className="sr-only">{t('paymentForm.expiryDate')}</label>
                    <input
                      type="text"
                      id="expiryDate"
                      value={expiryDate}
                      onChange={handleExpiryChange}
                      placeholder={t('paymentForm.expiryPlaceholder')}
                      maxLength={5}
                      className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                        errors.expiryDate ? 'border-destructive' : 'border-input'
                      }`}
                    />
                    {errors.expiryDate && (
                      <p className="mt-1 text-sm text-destructive">{errors.expiryDate}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="cvv" className="sr-only">{t('paymentForm.securityCode')}</label>
                    <div className="relative">
                      <input
                        type="text"
                        id="cvv"
                        value={cvv}
                        onChange={handleCvvChange}
                        placeholder={t('paymentForm.cvvPlaceholder')}
                        maxLength={4}
                        className={`w-full px-4 py-3 pr-10 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                          errors.cvv ? 'border-destructive' : 'border-input'
                        }`}
                      />
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                    {errors.cvv && (
                      <p className="mt-1 text-sm text-destructive">{errors.cvv}</p>
                    )}
                  </div>
                </div>

                {/* Installments Selector */}
                {maxInstallments > 1 && (
                  <div className="space-y-2">
                    <label htmlFor="installments" className="sr-only">{t('paymentForm.installments')}</label>
                    <select
                      id="installments"
                      value={installments}
                      onChange={(e) => setInstallments(parseInt(e.target.value))}
                      className="w-full px-4 py-3 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
                    >
                      <option value={1}>{t('paymentForm.fullPayment')} — {formatPrice(chargeAmount)}</option>
                      {Array.from({ length: maxInstallments - 1 }, (_, i) => i + 2).map((num) => (
                        <option key={num} value={num}>
                          {num} {t('paymentForm.installments')} — {formatPrice(chargeAmount / num)} {t('paymentForm.perMonth')}
                        </option>
                      ))}
                    </select>

                    {/* Installment breakdown */}
                    {installments > 1 && (
                      <div className="rounded-md bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/50 px-3 py-2">
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                          💳 {installments} {t('paymentForm.interestFreePayments')} {formatPrice(perInstallment)}
                          {giftCardAmount > 0 && (
                            <> ({t('paymentForm.giftCardChargedSeparately').replace('{amount}', formatPrice(giftCardAmount))})</>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                )}


              </div>
            </div>
          ) : (
            <div className="rounded-xl border-2 border-[#2b5686] bg-gradient-to-b from-[#2b5686]/5 to-[#2eb3b8]/5 p-6 text-center space-y-4">
              <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-gradient-to-b from-[#2b5686] to-[#2eb3b8] mb-2 shadow-lg">
                 <Image src="/bit.png" alt="Bit" width={48} height={28} style={{ objectFit: 'contain' }} />
              </div>
              <h3 className="text-lg font-bold text-foreground">{t('paymentForm.payWithBitTitle')}</h3>
              <p className="text-sm text-muted-foreground max-w-[280px] mx-auto">
                {t('paymentForm.bitDescription')}
              </p>
            </div>
          )}
        </div>
      )}

        {/* Security Badge */}
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Shield className="h-4 w-4" />
          <span>{t('paymentForm.paymentInfoSecure')}</span>
        </div>

{/* Terms and Conditions Checkbox */}
        <div className="flex flex-col items-center justify-center mt-6">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="terms"
              checked={termsAccepted}
              onChange={(e) => {
                setTermsAccepted(e.target.checked)
                if (errors.terms) setErrors((prev) => ({ ...prev, terms: '' }))
              }}
              className="h-4 w-4 rounded border-gray-300 text-foreground focus:ring-foreground accent-foreground cursor-pointer"
            />
            <label htmlFor="terms" className="text-sm text-muted-foreground select-none cursor-pointer">
              {t('paymentForm.agreeTerms')}{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setShowTerms(true);
                }}
                className="underline hover:text-foreground transition-colors outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded-sm"
              >
                {t('paymentForm.theTerms')}
              </button>.
            </label>
          </div>
          {errors.terms && (
            <p className="mt-2 text-sm text-destructive font-medium">{errors.terms}</p>
          )}
        </div>
        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row gap-4 items-center">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-foreground hover:opacity-70 transition-opacity"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('paymentForm.returnToInfo')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full sm:flex-1 py-4 px-6 rounded-lg font-semibold text-base transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              paymentMethod === 'bit' 
                ? 'bg-gradient-to-b from-[#2b5686] to-[#2eb3b8] text-white hover:opacity-90 focus:ring-[#2b5686]' 
                : 'bg-foreground text-background hover:opacity-90 focus:ring-ring'
            }`}
          >
            {isSubmitting
              ? t('paymentForm.processing')
              : chargeAmount > 0
                ? (paymentMethod === 'bit' ? t('paymentForm.payWithBit') : `${t('paymentForm.pay')} ${formatPrice(chargeAmount)}`)
                : t('paymentForm.completeOrderGiftCard').replace('{amount}', formatPrice(0))
            }
          </button>
        </div>

        
      </form>

      {/* Payment Error Popup */}
      {paymentError && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-md mx-4 bg-background rounded-2xl shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Red top accent bar */}
            <div className="h-1.5 w-full bg-gradient-to-r from-red-500 via-red-400 to-orange-400" />
            
            <div className="p-6 text-center space-y-4">
              {/* Error icon */}
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-bold text-foreground">{t('paymentForm.paymentDeclined')}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {paymentError}
                </p>
              </div>

              <div className="pt-2 space-y-3">
                <button
                  onClick={() => {
                    setPaymentError(null)
                    setIsSubmitting(false)
                  }}
                  className="w-full py-3 px-6 rounded-xl bg-foreground text-background font-semibold text-sm hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  {t('paymentForm.tryAgain')}
                </button>
                <p className="text-xs text-muted-foreground">
                  {t('paymentForm.verifyCardBalance')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3DS Challenge — inline iframe */}
      {show3DS && threeDSUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-lg bg-background rounded-xl shadow-2xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-foreground" />
                <span className="text-sm font-medium text-foreground">{t('paymentForm.threeDSVerification')}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                  <span className="text-xs text-muted-foreground">{t('paymentForm.verifying')}</span>
                </div>
                <button
                  onClick={() => close3DS('User Cancel')}
                  className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
                >
                  {t('paymentForm.cancel')}
                </button>
              </div>
            </div>
            <iframe
              src={threeDSUrl}
              className="w-full border-0"
              style={{ height: '500px' }}
              title="3D Secure Verification"
            />
          </div>
        </div>
      )}

      {/* Terms and Conditions Modal */}
      {showTerms && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-2xl bg-background rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
              <h2 className="text-xl font-bold text-foreground">{t('paymentForm.termsOfUse')}</h2>
              <button
                onClick={() => setShowTerms(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-4 text-sm text-foreground overflow-x-hidden leading-relaxed">
              <div className="whitespace-pre-wrap">
                {lang === 'he' ? TERMS_TEXT_HE : TERMS_TEXT_EN}
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-border bg-muted/30 flex justify-end">
              <button
                onClick={() => setShowTerms(false)}
                className="py-2 px-6 rounded-lg bg-foreground text-background font-semibold text-sm hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                {t('paymentForm.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



function CardBrand({ type }: { type: string }) {
  const brands: Record<string, { bg: string; text: string, src?: string }> = {
    visa: { bg: 'transparent', text: 'VISA', src: '/visa.png' },
    mastercard: { bg: 'transparent', text: 'MC', src: '/master.png' },
    discover: { bg: 'transparent', text: 'DISC', src: '/discover.jpg' },
    amex: { bg: 'transparent', text: 'AMEX', src: '/amex.png' },
    diners: { bg: 'transparent', text: 'DINERS', src: '/Diners_Club_Logo.svg' },
    generic: { bg: 'bg-muted', text: 'generic' },
  }

  const brand = brands[type] || brands.generic

  if (type === 'generic') {
    return <CreditCard className="h-6 w-6 text-muted-foreground" />
  }

  return (
    <div className={`h-6 px-2 rounded ${brand.bg} flex items-center justify-center`}>
      <span className="text-[10px] font-bold text-white">
        {brand.src ? (
          <Image src={brand.src} alt={brand.text} width={30} height={20} style={{
            width: '50px',
            height: '40px',
            objectFit: 'contain',

          }}/>
        ) : (
          brand.text
        )}
      </span>
    </div>
  )
}
