'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, CreditCard, Lock, Shield, Info } from 'lucide-react'
import type { CustomerInfo } from '@/lib/types'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { RealtimeChannel } from '@supabase/supabase-js'
import Image from 'next/image'
import { useLanguage } from '@/lib/language-context'
import { TERMS_TEXT_EN, TERMS_TEXT_HE } from '@/lib/terms'

interface PaymentFormProps {
  sessionId: string
  customerInfo: CustomerInfo
  total: number
  currency: string
  shopDomain?: string
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
  shopDomain,
  onBack,
  onSuccess,
  onError,
  onProcessing,
  giftCardId,
  giftCardCode,
  giftCardAmount = 0,
}: PaymentFormProps) {
  const [cardNumber, setCardNumber]       = useState('')
  const [cardholderName, setCardholderName] = useState('')
  const [expiryDate, setExpiryDate]       = useState('')
  const [cvv, setCvv]                     = useState('')
  const [errors, setErrors]               = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting]   = useState(false)
  const [show3DS, setShow3DS]             = useState(false)
  const [threeDSUrl, setThreeDSUrl]       = useState('')
  const [installments, setInstallments]   = useState(1)
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'bit'>('card')
  const [paymentError, setPaymentError]   = useState<string | null>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showTerms, setShowTerms]         = useState(false)
  const { t, lang } = useLanguage()

  // ── Refs that survive re-renders without triggering them ──────────────────
  const isSubmittingRef  = useRef(false)
  // FIX 1: Track whether we are actively waiting for 3DS/Bit completion.
  // This prevents the `finally` block from resetting the submitting state
  // while the payment modal is still open.
  const is3DSActiveRef   = useRef(false)
  // Track if the user explicitly cancelled the modal — prevents late poll/realtime
  // results from triggering error popups after dismissal.
  const cancelledRef     = useRef(false)
  const channelRef       = useRef<RealtimeChannel | null>(null)
  const pollIntervalRef  = useRef<NodeJS.Timeout | null>(null)
  const pollTimeoutRef   = useRef<NodeJS.Timeout | null>(null)
  const messageHandlerRef = useRef<((e: MessageEvent) => void) | null>(null)

  // ── Cleanup helpers ───────────────────────────────────────────────────────

  const clearPoll = useCallback(() => {
    if (pollIntervalRef.current)  { clearInterval(pollIntervalRef.current);  pollIntervalRef.current  = null }
    if (pollTimeoutRef.current)   { clearTimeout(pollTimeoutRef.current);    pollTimeoutRef.current   = null }
  }, [])

  const clearListeners = useCallback(() => {
    if (messageHandlerRef.current) {
      window.removeEventListener('message', messageHandlerRef.current)
      messageHandlerRef.current = null
    }
    if (channelRef.current) {
      try { channelRef.current.unsubscribe() } catch {}
      channelRef.current = null
    }
    clearPoll()
  }, [clearPoll])

  // FIX 1 (continued): close3DS resets ALL state including the submitting lock
  const close3DS = useCallback((source: string) => {
    console.log(`[3DS] Closing modal (source: ${source})`)
    // If user explicitly cancelled, mark as cancelled so late-arriving
    // poll/realtime events do NOT show error popups.
    if (source === 'User Cancel') {
      cancelledRef.current = true
      // Reset session status back to 'pending' so the user can retry
      fetch(`/api/checkout/session/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch((err) => console.error('[3DS] Failed to reset session:', err))
    }
    is3DSActiveRef.current = false
    clearListeners()
    setShow3DS(false)
    setThreeDSUrl('')
    setIsSubmitting(false)
    isSubmittingRef.current = false
  }, [clearListeners, sessionId])

  // Unmount cleanup
  useEffect(() => () => clearListeners(), [clearListeners])

  const chargeAmount    = Math.max(total - giftCardAmount, 0)
  const maxInstallments = getMaxInstallments(chargeAmount, currency)

  useEffect(() => {
    if (installments > maxInstallments) setInstallments(1)
  }, [installments, maxInstallments])

  // ── Input formatters ──────────────────────────────────────────────────────

  const formatCardNumber = (value: string) => {
    const digits = value.replace(/\D/g, '')
    const groups = digits.match(/.{1,4}/g)
    return groups ? groups.join(' ').substring(0, 19) : ''
  }

  const formatExpiryDate = (value: string) => {
    const digits = value.replace(/\D/g, '')
    if (digits.length >= 2) return digits.substring(0, 2) + '/' + digits.substring(2, 4)
    return digits
  }

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCardNumber(formatCardNumber(e.target.value))
    if (errors.cardNumber) setErrors(p => ({ ...p, cardNumber: '' }))
  }

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setExpiryDate(formatExpiryDate(e.target.value))
    if (errors.expiryDate) setErrors(p => ({ ...p, expiryDate: '' }))
  }

  const handleCvvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCvv(e.target.value.replace(/\D/g, '').substring(0, 4))
    if (errors.cvv) setErrors(p => ({ ...p, cvv: '' }))
  }

  // ── Validation ────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!termsAccepted) {
      newErrors.terms = t('paymentForm.acceptTermsError')
    }

    if (paymentMethod !== 'bit') {
      const cardDigits = cardNumber.replace(/\s/g, '')
      if (!cardDigits || cardDigits.length < 13)
        newErrors.cardNumber = t('paymentForm.invalidCardNumber')

      if (!cardholderName.trim())
        newErrors.cardholderName = t('paymentForm.cardholderRequired')

      if (!expiryDate || expiryDate.length < 5) {
        newErrors.expiryDate = t('paymentForm.invalidExpiry')
      } else {
        const [month, year] = expiryDate.split('/')
        const currentYear  = new Date().getFullYear() % 100
        const currentMonth = new Date().getMonth() + 1
        if (
          parseInt(month) < 1 || parseInt(month) > 12 ||
          parseInt(year) < currentYear ||
          (parseInt(year) === currentYear && parseInt(month) < currentMonth)
        ) {
          newErrors.expiryDate = t('paymentForm.cardExpired')
        }
      }

      if (!cvv || cvv.length < 3)
        newErrors.cvv = t('paymentForm.invalidCvv')
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // ── Poll helper (shared between card 3DS and Bit) ─────────────────────────

  const startSessionPolling = useCallback((delayMs: number) => {
    pollTimeoutRef.current = setTimeout(() => {
      pollIntervalRef.current = setInterval(async () => {
        if (cancelledRef.current) { clearPoll(); return }
        console.log('[POLL] Checking session status...')
        try {
          const res  = await fetch(`/api/checkout/session?id=${sessionId}`)
          if (!res.ok) return
          const data = await res.json()

          if (data.status === 'paid') {
            clearPoll()
            clearListeners()
            close3DS('Poll Success')
            onSuccess(
              data.tranzila_transaction_id || 'confirmed',
              data.raw_response?.shopifyOrderUrl,
              data.raw_response?._generated_gift_cards,
              data.raw_response?._gift_card?.remainingBalance,
              giftCardCode,
            )
          } else if (data.status === 'failed') {
            clearPoll()
            clearListeners()
            // Only show error if user hasn't cancelled
            if (!cancelledRef.current) {
              close3DS('Poll Failure')
              setPaymentError(data.error_message || t('paymentForm.paymentDeclinedGeneric'))
            }
          }
        } catch (e) {
          console.error('[POLL] Error:', e)
        }
      }, 5000)
    }, delayMs)
  }, [sessionId, giftCardCode, clearPoll, clearListeners, close3DS, onSuccess, t])

  // ── Active 3DS Polling (forces backend to check Tranzila status) ─────────

  const start3DSActivePolling = useCallback((trackId: string) => {
    // Start immediately, check every 4 seconds
    pollIntervalRef.current = setInterval(async () => {
      if (cancelledRef.current) { clearPoll(); return }
      console.log('[POLL] Actively checking 3DS completion via /api/checkout/3ds-complete...')
      try {
        const res = await fetch('/api/checkout/3ds-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId, sessionId })
        })
        if (!res.ok) return
        const data = await res.json()
        
        if (data.success) {
          console.log('[POLL] 3DS Active Poll Success!')
          clearPoll()
          clearListeners()
          close3DS('Active Poll Success')
          onSuccess(
            data.confirmationCode || 'confirmed',
            data.shopifyOrderUrl,
            data.generatedGiftCards,
            data.giftCardRemainingBalance,
            giftCardCode
          )
        } else if (!data.pending && data.error) {
          console.log('[POLL] 3DS Active Poll Failure:', data.error)
          clearPoll()
          clearListeners()
          // Only show error if user hasn't cancelled
          if (!cancelledRef.current) {
            close3DS('Active Poll Failure')
            setPaymentError(data.error || t('paymentForm.paymentDeclinedGeneric'))
          }
        } else {
          console.log('[POLL] 3DS Still pending...')
        }
      } catch (e) {
        console.error('[POLL] Error in 3DS active poll:', e)
      }
    }, 4000)
  }, [sessionId, giftCardCode, clearPoll, clearListeners, close3DS, onSuccess, t])

  // ── Realtime subscription (shared between card 3DS and Bit) ──────────────

  const startRealtimeSubscription = useCallback(() => {
    const supabase = createSupabaseClient()
    const channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'payment_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          if (cancelledRef.current) return
          const newStatus = payload.new.status
          console.log(`[REALTIME] Status: ${newStatus}`)

          if (newStatus === 'paid') {
            clearListeners()
            close3DS('Realtime Success')
            onSuccess(
              payload.new.tranzila_transaction_id || 'confirmed',
              payload.new.raw_response?.shopifyOrderUrl,
              payload.new.raw_response?._generated_gift_cards,
              payload.new.raw_response?._gift_card?.remainingBalance,
              giftCardCode,
            )
          } else if (newStatus === 'failed') {
            clearListeners()
            // Only show error if user hasn't cancelled the modal
            if (!cancelledRef.current) {
              close3DS('Realtime Failure')
              setPaymentError(payload.new.error_message || t('paymentForm.paymentDeclinedGeneric'))
            }
          }
        }
      )
      .subscribe()

    channelRef.current = channel
  }, [sessionId, giftCardCode, clearListeners, close3DS, onSuccess, t])

  // ── Open the 3DS / Bit modal and set up all listeners ────────────────────

  const open3DSModal = useCallback((redirectUrl: string, method: 'card' | 'bit', trackId?: string) => {
    // Reset cancelled flag when opening a new modal
    cancelledRef.current = false
    is3DSActiveRef.current = true
    setThreeDSUrl(redirectUrl)
    setShow3DS(true)

    startRealtimeSubscription()

    // PostMessage listener — used for BOTH card 3DS and Bit
    // 3DS callback and Bit callback both send postMessage with type '3DS_COMPLETE'
    const messageHandler = async (event: MessageEvent) => {
      if (cancelledRef.current) return

      let eventData = event.data
      try {
        if (typeof eventData === 'string') eventData = JSON.parse(eventData)
      } catch {}

      if (eventData?.type !== '3DS_COMPLETE' && !eventData?.track_id) return
      if (eventData.sessionId && eventData.sessionId !== sessionId) return

      console.log(`[${method.toUpperCase()}] PostMessage received:`, eventData)
      clearListeners()

      // Give the callback route a moment to finish writing the session
      await new Promise(r => setTimeout(r, 800))

      // Check session status from DB first (most reliable source of truth)
      let sessionData: any = null;
      try {
        const res  = await fetch(`/api/checkout/session?id=${sessionId}`)
        sessionData = res.ok ? await res.json() : null

        if (sessionData?.status === 'paid') {
          close3DS('PostMessage Success')
          onSuccess(
            sessionData.tranzila_transaction_id || 'confirmed',
            sessionData.raw_response?.shopifyOrderUrl,
            sessionData.raw_response?._generated_gift_cards,
            sessionData.raw_response?._gift_card?.remainingBalance,
            giftCardCode,
          )
          return
        }

        if (sessionData?.status === 'failed') {
          close3DS('PostMessage Failure')
          setPaymentError(sessionData.error_message || t('paymentForm.paymentDeclinedGeneric'))
          return
        }
      } catch {}

      // Handle Tranzila's native 3DS postMessage which has {"status":"success", "track_id":"..."}
      const isTranzilaNativeSuccess = eventData.status === 'success' && eventData.track_id;
      const isAppSuccess = eventData.success === true;
      
      if (isAppSuccess || isTranzilaNativeSuccess) {
        // If native Tranzila success but our DB still says 'processing', we MUST force a complete!
        if (isTranzilaNativeSuccess && sessionData?.status !== 'paid') {
          console.log(`[${method.toUpperCase()}] Native success received, but session not paid. Forcing 3ds-complete...`);
          try {
            const completeRes = await fetch('/api/checkout/3ds-complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ trackId: eventData.track_id, sessionId })
            });
            if (completeRes.ok) {
              const completeData = await completeRes.json();
              if (completeData.success) {
                close3DS('PostMessage Forced Complete Success');
                onSuccess(
                  completeData.confirmationCode || 'confirmed',
                  completeData.shopifyOrderUrl,
                  completeData.generatedGiftCards,
                  completeData.giftCardRemainingBalance,
                  giftCardCode
                );
                return;
              } else {
                close3DS('PostMessage Forced Complete Failure');
                setPaymentError(completeData.error || t('paymentForm.paymentDeclinedGeneric'));
                return;
              }
            }
          } catch (err) {
            console.error(`[${method.toUpperCase()}] Failed to force complete:`, err);
          }
        }

        close3DS('PostMessage Ambiguous Success')
        onSuccess(
          eventData.confirmationCode || eventData.track_id || 'confirmed', 
          undefined, undefined, undefined, giftCardCode
        )
      } else {
        close3DS('PostMessage Ambiguous Failure')
        setPaymentError(eventData.errorMessage || eventData.error || t('paymentForm.paymentDeclinedGeneric'))
      }
    }

    messageHandlerRef.current = messageHandler
    window.addEventListener('message', messageHandler)

    if (method === 'card') {
      // If we have a trackId, actively poll the complete endpoint!
      // This is necessary because Tranzila sometimes hangs on a JSON string in the iframe
      // and neither redirects nor sends a postMessage.
      if (trackId) {
        start3DSActivePolling(trackId)
      } else {
        // Fallback poll starts after 30 s if no trackId is available
        startSessionPolling(30_000)
      }
    } else {
      // Bit: postMessage + Realtime + poll (start sooner, user needs to scan QR)
      startSessionPolling(10_000)
    }
  }, [sessionId, giftCardCode, close3DS, clearListeners, startRealtimeSubscription, startSessionPolling, start3DSActivePolling, onSuccess, t])

  // ── Main submit handler ───────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmittingRef.current) return
    if (!validate()) return

    isSubmittingRef.current = true
    cancelledRef.current = false
    setIsSubmitting(true)
    setPaymentError(null)

    const browserData = {
      java_enabled:   navigator.javaEnabled() ? 1 : 0,
      language:       navigator.language || 'en-US',
      color_depth:    window.screen.colorDepth || 24,
      screen_height:  window.screen.height || 1080,
      screen_width:   window.screen.width || 1920,
      time_zone:      new Date().getTimezoneOffset(),
      user_agent:     navigator.userAgent,
      accept_header:  'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      window_size:    '04',
    }

    try {
      const response = await fetch('/api/checkout/charge', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sessionId,
          customerInfo,
          cardNumber:     chargeAmount > 0 ? cardNumber.replace(/\s/g, '') : undefined,
          expiryDate:     chargeAmount > 0 ? expiryDate : undefined,
          cvv:            chargeAmount > 0 ? cvv : undefined,
          cardholderName: (chargeAmount > 0 && paymentMethod === 'card') ? cardholderName : undefined,
          browserData:    (chargeAmount > 0 && paymentMethod === 'card') ? browserData : undefined,
          installments:   paymentMethod === 'card' ? installments : 1,
          paymentMethod,
          giftCardId:     giftCardId   || undefined,
          giftCardCode:   giftCardCode || undefined,
          giftCardAmount: giftCardAmount || undefined,
        }),
      })

      const result = await response.json()
      console.log('[PAYMENT-FORM] API response:', result)

      // ── FIX 3: accept BOTH field names for the redirect case.
      //    Server sends `requires3DS` for card 3DS and `requiresRedirect` for Bit.
      //    Both mean: "open the modal and wait for async completion".
      const needsModal = (result.requires3DS || result.requiresRedirect) && result.redirectUrl

      if (needsModal) {
        // FIX 1: mark 3DS as active so `finally` does NOT reset isSubmitting.
        // The modal stays open; close3DS() will reset it when complete or cancelled.
        is3DSActiveRef.current = true
        open3DSModal(result.redirectUrl, result.paymentMethod === 'bit' ? 'bit' : 'card', result.trackId)
        return
      }

      // Direct result path
      if (result.success) {
        onSuccess(
          result.confirmationCode,
          result.shopifyOrderUrl,
          result.generatedGiftCards,
          result.giftCardRemainingBalance,
          giftCardCode,
        )
      } else {
        setPaymentError(result.error || t('paymentForm.paymentFailed'))
      }

    } catch {
      setPaymentError(t('paymentForm.paymentProcessingFailed'))
    } finally {
      // FIX 1: Only reset submitting state if we are NOT waiting for 3DS/Bit.
      // If is3DSActiveRef is true, the modal handles cleanup via close3DS().
      if (!is3DSActiveRef.current) {
        setIsSubmitting(false)
        isSubmittingRef.current = false
      }
    }
  }

  // ── Formatters ────────────────────────────────────────────────────────────

  const formatPrice = (amount: number) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(amount)

  const getCardType = (number: string): string => {
    const cleaned = number.replace(/\s/g, '')
    if (/^4/.test(cleaned))      return 'visa'
    if (/^5[1-5]/.test(cleaned)) return 'mastercard'
    if (/^3[47]/.test(cleaned))  return 'amex'
    if (/^6(?:011|5)/.test(cleaned)) return 'discover'
    return 'generic'
  }

  const perInstallment = installments > 1 ? chargeAmount / installments : chargeAmount

  // ── Render ────────────────────────────────────────────────────────────────

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
          <button onClick={onBack} className="text-sm text-foreground underline hover:no-underline">
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

      {/* Payment Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {chargeAmount > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">{t('paymentForm.paymentTitle')}</h2>
            <p className="text-sm text-muted-foreground mb-4">{t('paymentForm.secureEncrypted')}</p>

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
                        className={`w-full px-4 py-3 pe-16 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                          errors.cardNumber ? 'border-destructive' : 'border-input'
                        }`}
                      />
                      <div className="absolute end-3 top-1/2 -translate-y-1/2">
                        <CardBrand type={getCardType(cardNumber)} />
                      </div>
                    </div>
                    {errors.cardNumber && <p className="mt-1 text-sm text-destructive">{errors.cardNumber}</p>}
                  </div>

                  <div>
                    <label htmlFor="cardholderName" className="sr-only">{t('paymentForm.cardholderName')}</label>
                    <input
                      type="text"
                      id="cardholderName"
                      value={cardholderName}
                      onChange={e => {
                        setCardholderName(e.target.value)
                        if (errors.cardholderName) setErrors(p => ({ ...p, cardholderName: '' }))
                      }}
                      placeholder={t('paymentForm.cardholderName')}
                      className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                        errors.cardholderName ? 'border-destructive' : 'border-input'
                      }`}
                    />
                    {errors.cardholderName && <p className="mt-1 text-sm text-destructive">{errors.cardholderName}</p>}
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
                      {errors.expiryDate && <p className="mt-1 text-sm text-destructive">{errors.expiryDate}</p>}
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
                          className={`w-full px-4 py-3 pe-10 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                            errors.cvv ? 'border-destructive' : 'border-input'
                          }`}
                        />
                        <Lock className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      </div>
                      {errors.cvv && <p className="mt-1 text-sm text-destructive">{errors.cvv}</p>}
                    </div>
                  </div>

                  {maxInstallments > 1 && (
                    <div className="space-y-2">
                      <label htmlFor="installments" className="sr-only">{t('paymentForm.installments')}</label>
                      <select
                        id="installments"
                        value={installments}
                        onChange={e => setInstallments(parseInt(e.target.value))}
                        className="w-full px-4 py-3 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
                      >
                        <option value={1}>{t('paymentForm.fullPayment')} — {formatPrice(chargeAmount)}</option>
                        {Array.from({ length: maxInstallments - 1 }, (_, i) => i + 2).map(num => (
                          <option key={num} value={num}>
                            {num} {t('paymentForm.installments')} — {formatPrice(chargeAmount / num)} {t('paymentForm.perMonth')}
                          </option>
                        ))}
                      </select>
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

        {/* Terms */}
        <div className="flex flex-col items-center justify-center mt-6">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="terms"
              checked={termsAccepted}
              onChange={e => {
                setTermsAccepted(e.target.checked)
                if (errors.terms) setErrors(p => ({ ...p, terms: '' }))
              }}
              className="h-4 w-4 rounded border-gray-300 text-foreground focus:ring-foreground accent-foreground cursor-pointer"
            />
            <label htmlFor="terms" className="text-sm text-muted-foreground select-none cursor-pointer">
              {t('paymentForm.agreeTerms')}{' '}
              <button
                type="button"
                onClick={e => { e.preventDefault(); setShowTerms(true) }}
                className="underline hover:text-foreground transition-colors outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded-sm"
              >
                {t('paymentForm.theTerms')}
              </button>.
            </label>
          </div>
          {errors.terms && <p className="mt-2 text-sm text-destructive font-medium">{errors.terms}</p>}
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row rtl:sm:flex-row-reverse gap-4 items-center mt-6">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center rtl:flex-row-reverse gap-2 text-sm text-foreground hover:opacity-70 transition-opacity"
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
                ? (paymentMethod === 'bit'
                    ? t('paymentForm.payWithBit')
                    : `${t('paymentForm.pay')} ${formatPrice(chargeAmount)}`)
                : t('paymentForm.completeOrderGiftCard').replace('{amount}', formatPrice(0))
            }
          </button>
        </div>
      </form>

      {/* ── 3DS / Bit challenge modal ────────────────────────────────────────
          z-[100] — always renders below the error popup layer (z-[110]).
          It is mutually exclusive with the error popup because:
          - Error popup only renders when `!show3DS && paymentError` (FIX 2)
          - close3DS() always clears show3DS BEFORE setPaymentError is called   */}
      {show3DS && threeDSUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-lg bg-background rounded-xl shadow-2xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-foreground" />
                <span className="text-sm font-medium text-foreground">
                  {paymentMethod === 'bit'
                    ? t('paymentForm.bitVerification')
                    : t('paymentForm.threeDSVerification')}
                </span>
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
              title={paymentMethod === 'bit' ? 'Bit Payment' : '3D Secure Verification'}
            />
          </div>
        </div>
      )}

      {/* ── Payment Error Popup ──────────────────────────────────────────────
          FIX 2: `!show3DS` guard ensures this is NEVER shown while the 3DS/Bit
          modal is open. Error is shown only after close3DS() has run.          */}
      {!show3DS && paymentError && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-md mx-4 bg-background rounded-2xl shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="h-1.5 w-full bg-gradient-to-r from-red-500 via-red-400 to-orange-400" />
            <div className="p-6 text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-foreground">{t('paymentForm.paymentDeclined')}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{paymentError}</p>
              </div>
              <div className="pt-2 space-y-3">
                <button
                  onClick={() => setPaymentError(null)}
                  className="w-full py-3 px-6 rounded-xl bg-foreground text-background font-semibold text-sm hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  {t('paymentForm.tryAgain')}
                </button>
                <a
                  href={`https://${shopDomain || 'rotmina.co'}`}
                  className="block w-full py-3 px-6 rounded-xl border border-border text-foreground font-semibold text-sm text-center hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  {t('paymentForm.returnToStore')}
                </a>
                <p className="text-xs text-muted-foreground">{t('paymentForm.verifyCardBalance')}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Terms Modal */}
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
  const brands: Record<string, { bg: string; text: string; src?: string }> = {
    visa:       { bg: 'transparent', text: 'VISA',   src: '/visa.png' },
    mastercard: { bg: 'transparent', text: 'MC',     src: '/master.png' },
    discover:   { bg: 'transparent', text: 'DISC',   src: '/discover.jpg' },
    amex:       { bg: 'transparent', text: 'AMEX',   src: '/amex.png' },
    diners:     { bg: 'transparent', text: 'DINERS', src: '/Diners_Club_Logo.svg' },
    generic:    { bg: 'bg-muted',    text: 'generic' },
  }

  const brand = brands[type] || brands.generic

  if (type === 'generic') return <CreditCard className="h-6 w-6 text-muted-foreground" />

  return (
    <div className={`h-6 px-2 rounded ${brand.bg} flex items-center justify-center`}>
      {brand.src ? (
        <Image src={brand.src} alt={brand.text} width={30} height={20} style={{ width: 50, height: 40, objectFit: 'contain' }} />
      ) : (
        <span className="text-[10px] font-bold text-white">{brand.text}</span>
      )}
    </div>
  )
}