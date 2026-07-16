'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, CreditCard, Shield, Info, X } from 'lucide-react'
import type { CustomerInfo, AppliedCoupon, ShopifyDiscount } from '@/lib/types'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { RealtimeChannel } from '@supabase/supabase-js'
import Image from 'next/image'
import Script from 'next/script'
import { useLanguage } from '@/lib/language-context'
import { storeUrl } from '@/lib/store-url'
import { TERMS_TEXT_EN, TERMS_TEXT_HE } from '@/lib/terms'
import { CouponForm } from '@/components/checkout/coupon-form'

interface PaymentFormProps {
  sessionId: string
  customerInfo: CustomerInfo
  total: number
  // Real charge currency (ILS/USD) — drives installment eligibility and the
  // actual Tranzila charge. Must NOT be swapped for a cosmetic currency.
  currency: string
  // Cosmetic display currency/rate (see checkout/[sessionId]/page.tsx),
  // for formatting only — the real charge always stays in `currency`/`total`.
  displayCurrency?: string
  displayRate?: number
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
  couponCode?: string
  couponAmount?: number
  shopifyDiscount?: ShopifyDiscount
  appliedCoupon: AppliedCoupon | null
  onCouponApply: (coupon: AppliedCoupon) => void
  onCouponRemove: () => void
}

function getMaxInstallments(amount: number, currency: string, country: string): number {
  if (country.toLowerCase() !== 'israel' && country.toUpperCase() !== 'IL') return 1

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

function getErrorHint(msg: string): string {
  const lower = msg.toLowerCase()
  if (lower.includes('expired') || lower.includes('expiry')) return 'Check that your card expiry date is correct.'
  if (lower.includes('cvv') || lower.includes('cvc') || lower.includes('id verification')) return 'Check that your CVV / security code is correct.'
  if (lower.includes('insufficient') || lower.includes('funds')) return 'Check your card balance or try a different card.'
  if (lower.includes('stolen') || lower.includes('lost') || lower.includes('blocked') || lower.includes('restricted')) return 'Contact your bank to resolve this issue.'
  if (lower.includes('pin')) return 'Check that your PIN is correct.'
  if (lower.includes('limit') || lower.includes('frequency')) return 'You may have reached your card usage limit – try a different card.'
  if (lower.includes('not permitted')) return 'Your card may not support this transaction type.'
  if (lower.includes('unavailable') || lower.includes('system error') || lower.includes('try again')) return 'This is a temporary issue. Please wait a moment and try again.'
  if (lower.includes('test') || lower.includes('mode') || lower.includes('mismatch')) return 'There is a configuration issue. Please contact support.'
  return 'Please verify your card details or try a different payment method.'
}

export function PaymentForm({
  sessionId,
  customerInfo,
  total,
  currency,
  displayCurrency,
  displayRate = 1,
  shopDomain,
  onBack,
  onSuccess,
  onError,
  onProcessing,
  giftCardId,
  giftCardCode,
  giftCardAmount = 0,
  couponCode,
  couponAmount = 0,
  shopifyDiscount,
  appliedCoupon,
  onCouponApply,
  onCouponRemove,
}: PaymentFormProps) {
  const shippingFeeAmount = 0
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [show3DS, setShow3DS] = useState(false)
  const [threeDSUrl, setThreeDSUrl] = useState('')
  const [popupWindowActive, setPopupWindowActive] = useState(false)
  const [installments, setInstallments] = useState(1)
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'bit'>('card')
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [loadingStep, setLoadingStep] = useState<'connecting' | 'completing' | null>(null)
  const [isBitQrActive, setIsBitQrActive] = useState(false)
  const [israeliId, setIsraeliId] = useState('')
  const [cardNumberOverride, setCardNumberOverride] = useState('')
  const [showTestCardInput, setShowTestCardInput] = useState(false)
  const { t, lang, dir } = useLanguage()

  const TEST_CARD = '5430050220380520'
  const isTestCardActive = showTestCardInput && cardNumberOverride.replace(/\s/g, '') === TEST_CARD

  // ── Refs that survive re-renders without triggering them ──────────────────
  const isSubmittingRef = useRef(false)
  const tzLoaded = useRef(false)
  const is3DSActiveRef = useRef(false)
  const cancelledRef = useRef(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const messageHandlerRef = useRef<((e: MessageEvent) => void) | null>(null)
  const popupRef = useRef<Window | null>(null)
  const popupMonitorRef = useRef<NodeJS.Timeout | null>(null)
  const challengeHandlerRef = useRef<((e: MessageEvent) => void) | null>(null)
  const had3DSChallengeRef = useRef(false)

  // FIX 5: hostedFields as a ref instead of state.
  // Using useState caused re-renders that could trigger re-initialization
  // loops and stale closure captures in charge callbacks.
  const hostedFieldsRef = useRef<any>(null)

  // ── Cleanup helpers ───────────────────────────────────────────────────────

  const clearPoll = useCallback(() => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
    if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null }
  }, [])

  const clearListeners = useCallback(() => {
    if (messageHandlerRef.current) {
      window.removeEventListener('message', messageHandlerRef.current)
      messageHandlerRef.current = null
    }
    if (channelRef.current) {
      try { channelRef.current.unsubscribe() } catch { }
      channelRef.current = null
    }
    clearPoll()
  }, [clearPoll])

  const close3DS = useCallback((source: string) => {
    console.log(`[3DS] Closing modal (source: ${source})`)
    if (source === 'User Cancel') {
      cancelledRef.current = true
      fetch(`/api/checkout/session/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch((err) => console.error('[3DS] Failed to reset session:', err))
    }
    if (popupMonitorRef.current) { clearInterval(popupMonitorRef.current); popupMonitorRef.current = null }
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close()
    popupRef.current = null
    is3DSActiveRef.current = false
    clearListeners()
    setShow3DS(false)
    setThreeDSUrl('')
    setPopupWindowActive(false)
    setLoadingStep(null)
    setIsBitQrActive(false)
    setIsSubmitting(false)
    isSubmittingRef.current = false
  }, [clearListeners, sessionId])

  // Unmount cleanup
  useEffect(() => () => clearListeners(), [clearListeners])

  // Auto-clear the Bit QR flag whenever the payment flow ends
  useEffect(() => {
    if (!isSubmitting) setIsBitQrActive(false)
  }, [isSubmitting])

  const chargeAmount = Math.max(total - couponAmount - giftCardAmount, 0)
  const maxInstallments = getMaxInstallments(chargeAmount, currency, customerInfo.country)

  useEffect(() => {
    if (installments > maxInstallments) setInstallments(1)
  }, [installments, maxInstallments])

  // ── Hosted Fields Initialization ──────────────────────────────────────────
  // The SDK is used for card input fields only.
  // Valid field IDs: credit_card_number, cvv, expiry, card_holder_id_number.
  // Bit payments use the separate chargeBit() method which creates its own
  // full-screen overlay — no SDK field container is needed for Bit.

  const initTranzila = useCallback(() => {
    if (!tzLoaded.current) {
      console.log('[TZ] initTranzila: SDK not yet loaded')
      return
    }
    if (hostedFieldsRef.current) {
      console.log('[TZ] initTranzila: already initialized, skipping')
      return
    }
    if (chargeAmount <= 0) {
      console.log('[TZ] initTranzila: chargeAmount is 0, skipping')
      return
    }
    // @ts-ignore
    if (typeof window.TzlaHostedFields === 'undefined') {
      console.warn('[TZ] initTranzila: TzlaHostedFields not on window yet')
      return
    }

    const sandboxMode = process.env.NEXT_PUBLIC_TRANZILA_TEST_MODE === 'true'
    console.log(`[TZ] initTranzila: starting | sandbox=${sandboxMode} | chargeAmount=${chargeAmount}`)

    // Defer one tick so React has finished committing all DOM nodes.
    setTimeout(() => {
      if (hostedFieldsRef.current) return // guard against double-init

      const cardContainersOk =
        !!document.querySelector('#credit_card_number') &&
        !!document.querySelector('#cvv') &&
        !!document.querySelector('#expiry')

      console.log(`[TZ] DOM check — card containers: ${cardContainersOk}`)

      if (!cardContainersOk) {
        console.warn('[TZ] Card field containers not found in DOM, skipping init.')
        return
      }

      try {
        // dispay all info i send to tranzila for hosted field request before send it
        console.log('payload:', {
          sandbox: sandboxMode,
          terminal: process.env.NEXT_PUBLIC_TRANZILA_TERMINAL || 'fxprotmina',
          fields: {
            credit_card_number: { selector: '#credit_card_number' },
            cvv: { selector: '#cvv' },
            expiry: { selector: '#expiry' },
          },
        })
        const sdkConfig: any = {
          sandbox: sandboxMode,
          terminal: process.env.NEXT_PUBLIC_TRANZILA_TERMINAL || 'fxprotmina',
          styles: {
            input: {
              'padding': '0 12px',
              'font-size': '16px',
              'font-family': 'sans-serif',
              'color': 'currentColor',
              'width': '100%',
              'height': '100%',
              'background': 'transparent',
              'border': 'none',
              'outline': 'none',
            },
          },
          fields: {
            credit_card_number: { selector: '#credit_card_number' },
            cvv: { selector: '#cvv' },
            expiry: { selector: '#expiry' },
          },
        }
        // No thtk at create() time — Tranzila confirmed that thtk should be
        // generated fresh server-side at charge time. The SDK is initialized
        // without a token; the fresh thtk will be passed to charge()/chargeBit().
        console.log(`[TZ] Calling create() without thtk (will be generated fresh at charge time)`)

        // @ts-ignore
        const instance = window.TzlaHostedFields.create(sdkConfig)
        console.log('instance', instance)
        console.log('sdkConfig', sdkConfig)
        hostedFieldsRef.current = instance
        console.log(`[TZ] ✅ Hosted fields initialized`)
      } catch (err) {
        console.error('[TZ] Hosted fields init error:', err)
      }
    }, 0)
  }, [chargeAmount])

  useEffect(() => {
    initTranzila()
  }, [initTranzila])

  // ── Validation ────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    // Terms validation
    if (!termsAccepted) {
      newErrors.terms = t('paymentForm.acceptTermsError')
    }

    // Card field validation - check if hosted fields are ready
    if (paymentMethod === 'card') {
      if (lang === 'he' && chargeAmount > 0 && !israeliId.trim()) {
        newErrors.israeliId = t('customerForm.idRequired')
      }

      // Check if hosted fields are initialized (skipped for test card bypass)
      if (!isTestCardActive && !hostedFieldsRef.current) {
        newErrors.card = t('paymentForm.paymentSystemNotReady')
        setErrors(newErrors)
        return false
      }

      // Additional validation for installments
      if (installments > maxInstallments) {
        newErrors.installments = `Maximum ${maxInstallments} installments allowed for this amount`
      }
    }

    // Bit payment validation
    if (paymentMethod === 'bit' && chargeAmount < 5) {
      newErrors.bit = 'Bit requires a minimum payment of 5 NIS. Please use a credit card for this order.'
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
          const res = await fetch(`/api/checkout/session?id=${sessionId}`)
          if (!res.ok) return
          const data = await res.json()

          console.log(`[POLL] Session status: ${data.status} | error_message: ${data.error_message ?? 'none'}`)

          if (data.status === 'paid') {
            if (cancelledRef.current) { clearPoll(); return }
            console.log('[POLL] ✅ Payment confirmed! txnId:', data.tranzila_transaction_id)
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
            const errMsg = data.error_message || t('paymentForm.paymentDeclinedGeneric')
            console.log(`[POLL] ❌ Payment failed. error_message: "${errMsg}"`)
            clearPoll()
            clearListeners()
            if (!cancelledRef.current) {
              close3DS('Poll Failure')
              setPaymentError(errMsg)
            }
          }
        } catch (e) {
          console.error('[POLL] Error:', e)
        }
      }, 5000)
    }, delayMs)
  }, [sessionId, giftCardCode, clearPoll, clearListeners, close3DS, onSuccess, t])

  // ── Active 3DS Polling ────────────────────────────────────────────────────

  const start3DSActivePolling = useCallback((trackId: string) => {
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
          if (cancelledRef.current) { clearPoll(); return }
          clearPoll(); clearListeners()
          close3DS('Active Poll Success')
          onSuccess(data.confirmationCode || 'confirmed', data.shopifyOrderUrl, data.generatedGiftCards, data.giftCardRemainingBalance, giftCardCode)
        } else if (!data.pending && data.error) {
          clearPoll(); clearListeners()
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

  // ── Realtime subscription ─────────────────────────────────────────────────

  const startRealtimeSubscription = useCallback(() => {
    console.log(`[REALTIME] Subscribing to session-${sessionId}`)
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

          console.log(`[REALTIME] Status changed to: ${newStatus} | error_message: ${payload.new.error_message ?? 'none'}`)

          if (newStatus === 'paid') {
            console.log('[REALTIME] ✅ Payment confirmed! txnId:', payload.new.tranzila_transaction_id)
            clearListeners(); close3DS('Realtime Success')
            onSuccess(
              payload.new.tranzila_transaction_id || 'confirmed',
              payload.new.raw_response?.shopifyOrderUrl,
              payload.new.raw_response?._generated_gift_cards,
              payload.new.raw_response?._gift_card?.remainingBalance,
              giftCardCode,
            )
          } else if (newStatus === 'failed') {
            const errMsg = payload.new.error_message || t('paymentForm.paymentDeclinedGeneric')
            console.log(`[REALTIME] ❌ Payment failed. error_message: "${errMsg}"`)
            clearListeners()
            if (!cancelledRef.current) {
              close3DS('Realtime Failure')
              setPaymentError(errMsg)
            }
          }
        }
      )
      .subscribe()

    channelRef.current = channel
  }, [sessionId, giftCardCode, clearListeners, close3DS, onSuccess, t])

  // ── Open the 3DS / Bit modal ──────────────────────────────────────────────

  const open3DSModal = useCallback((redirectUrl: string, method: 'card' | 'bit', trackId?: string) => {
    cancelledRef.current = false
    is3DSActiveRef.current = true

    // Open 3DS/Bit in a popup so ACS pages that set X-Frame-Options:sameorigin
    // (e.g. wibmo.com) are not blocked. Iframes cannot embed cross-origin pages
    // that restrict framing.
    const screenW = window.screen.width || 1280
    const screenH = window.screen.height || 800
    const popW = 520, popH = 680
    const left = Math.round((screenW - popW) / 2)
    const top = Math.round((screenH - popH) / 2)
    const popup = window.open(
      redirectUrl,
      '3dsAuth',
      `width=${popW},height=${popH},left=${left},top=${top},resizable=yes,scrollbars=yes`
    )

    if (!popup) {
      // Popup was blocked — fall back to iframe overlay
      console.warn('[3DS] Popup blocked, falling back to iframe')
      setThreeDSUrl(redirectUrl)
      setShow3DS(true)
    } else {
      // Popup opened successfully — show mini banner, no overlay
      setPopupWindowActive(true)
    }
    popupRef.current = popup

    // Detect when user closes the popup manually
    popupMonitorRef.current = setInterval(() => {
      if (popupRef.current?.closed && is3DSActiveRef.current) {
        console.log('[3DS] Popup closed by user')
        close3DS('User Cancel')
      }
    }, 600)

    startRealtimeSubscription()

    const messageHandler = async (event: MessageEvent) => {
      if (cancelledRef.current) return

      let eventData = event.data
      try {
        if (typeof eventData === 'string') eventData = JSON.parse(eventData)
      } catch { }

      if (eventData?.type !== '3DS_COMPLETE' && !eventData?.track_id) return
      if (eventData.sessionId && eventData.sessionId !== sessionId) return

      console.log(`[${method.toUpperCase()}] PostMessage received:`, eventData)
      clearListeners()

      await new Promise(r => setTimeout(r, 800))
      if (cancelledRef.current) return

      let sessionData: any = null
      try {
        const res = await fetch(`/api/checkout/session?id=${sessionId}`)
        sessionData = res.ok ? await res.json() : null
        if (cancelledRef.current) return

        if (sessionData?.status === 'paid') {
          close3DS('PostMessage Success')
          onSuccess(sessionData.tranzila_transaction_id || 'confirmed', sessionData.raw_response?.shopifyOrderUrl, sessionData.raw_response?._generated_gift_cards, sessionData.raw_response?._gift_card?.remainingBalance, giftCardCode)
          return
        }
        if (sessionData?.status === 'failed') {
          close3DS('PostMessage Failure')
          setPaymentError(sessionData.error_message || t('paymentForm.paymentDeclinedGeneric'))
          return
        }
      } catch { }

      const isTranzilaNativeSuccess = eventData.status === 'success' && eventData.track_id
      const isAppSuccess = eventData.success === true

      if (isAppSuccess || isTranzilaNativeSuccess) {
        if (isTranzilaNativeSuccess && sessionData?.status !== 'paid') {
          console.log(`[${method.toUpperCase()}] Native success received, but session not paid. Forcing 3ds-complete...`)
          try {
            const completeRes = await fetch('/api/checkout/3ds-complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ trackId: eventData.track_id, sessionId })
            })
            if (completeRes.ok) {
              const completeData = await completeRes.json()
              if (completeData.success) {
                close3DS('PostMessage Forced Complete Success')
                onSuccess(completeData.confirmationCode || 'confirmed', completeData.shopifyOrderUrl, completeData.generatedGiftCards, completeData.giftCardRemainingBalance, giftCardCode)
                return
              } else {
                close3DS('PostMessage Forced Complete Failure')
                setPaymentError(completeData.error || t('paymentForm.paymentDeclinedGeneric'))
                return
              }
            }
          } catch (err) {
            console.error(`[${method.toUpperCase()}] Failed to force complete:`, err)
          }
        }
        close3DS('PostMessage Ambiguous Success')
        onSuccess(eventData.confirmationCode || eventData.track_id || 'confirmed', undefined, undefined, undefined, giftCardCode)
      } else {
        close3DS('PostMessage Ambiguous Failure')
        setPaymentError(eventData.errorMessage || eventData.error || t('paymentForm.paymentDeclinedGeneric'))
      }
    }

    messageHandlerRef.current = messageHandler
    window.addEventListener('message', messageHandler)

    if (method === 'card') {
      if (trackId) {
        start3DSActivePolling(trackId)
      } else {
        startSessionPolling(30_000)
      }
    } else {
      // Bit: the payment happens on the user's phone, so the iframe on desktop
      // may never navigate. Poll immediately and frequently so the modal closes
      // as soon as the backend webhook/notify updates the session.
      console.log('[BIT] Starting immediate polling (Bit payment — phone-based flow)')
      startSessionPolling(0)
    }
  }, [sessionId, giftCardCode, close3DS, clearListeners, startRealtimeSubscription, startSessionPolling, start3DSActivePolling, onSuccess, t])

  // ── Main submit handler ───────────────────────────────────────────────────

  // ── Tranzila error helpers (shared between card and Bit) ─────────────────

  const TRANZILA_CODE_MAP: Record<string, string> = {
    '001': 'Card blocked – please contact your bank',
    '002': 'Card reported stolen – contact your bank',
    '003': 'Contact your credit company',
    '004': 'Transaction refused by bank',
    '005': 'Card rejected by bank (do not honor)',
    '006': 'CVV or ID verification error',
    '007': 'Contact your credit company',
    '009': 'Transaction not permitted',
    '010': 'Transaction not approved',
    '011': 'Invalid transaction amount',
    '012': 'Invalid card number',
    '013': 'Invalid amount',
    '014': 'Invalid card number or terminal',
    '015': 'Terminal not found',
    '017': 'Card has expired',
    '033': 'Currency mismatch or test/live mode configuration error',
    '041': 'Lost card – contact your bank',
    '043': 'Stolen card – contact your bank',
    '051': 'Insufficient funds on card',
    '054': 'Card has expired',
    '055': 'Incorrect PIN',
    '057': 'Transaction not permitted to this cardholder',
    '058': 'Transaction not permitted on this terminal',
    '061': 'Card withdrawal limit exceeded',
    '062': 'Restricted card',
    '065': 'Card usage frequency limit exceeded',
    '091': 'Card issuer unavailable – please try again',
    '096': 'Payment system error – please try again',
    '900': 'Transaction cancelled or declined by processor',
  }

  const parseTranzilaError = useCallback((res: any, isBit?: boolean): string => {
    if (!res || res === false) {
      console.warn('[PARSE-ERROR] tzResult is null/false — SDK did not return a response object')
      return isBit
        ? 'Bit payment could not be initiated. Please try again or use card payment.'
        : 'Card payment was declined. Please verify your details or try Bit payment.'
    }
    // SDK failure indicator: {error: 'bt_failed'} with no further details
    if (res?.error === 'bt_failed') {
      console.warn('[PARSE-ERROR] SDK returned bt_failed — charge rejected at gateway level (check thtk / sandbox mode / terminal config)')
      return isBit
        ? 'Bit payment failed. Please try again.'
        : 'Card payment failed. Please try again or contact support.'
    }
    console.log('[PARSE-ERROR] Raw result:', JSON.stringify(res))

    if (typeof res.error_code === 'number' && res.error_code !== 0) {
      let msg = res.message || `API error (code: ${res.error_code})`
      if (Array.isArray(res.mismatch_info) && res.mismatch_info.length > 0) {
        msg += ' (' + res.mismatch_info.map((m: any) => `${(m.data_path || []).join('.')}: ${m.keyword}`).join(', ') + ')'
      }
      console.log('[PARSE-ERROR] error_code path →', msg)
      return msg
    }
    // transaction_response is the format used by the Hosted Fields SDK (Diners Club, non-3DS)
    const txnResponse = res.transaction_response
    if (txnResponse?.success === false || (txnResponse?.processor_response_code && txnResponse.processor_response_code !== '000')) {
      const code = txnResponse?.processor_response_code
      if (code && code !== '000') {
        const msg = TRANZILA_CODE_MAP[code] || `Card declined (code: ${code})`
        console.log('[PARSE-ERROR] transaction_response.processor_response_code:', code, '→', msg)
        return msg
      }
      const errMsg = txnResponse?.error || 'Card declined during payment validation'
      console.log('[PARSE-ERROR] transaction_response.success=false →', errMsg)
      return errMsg
    }
    const txnResult = res.transaction_result
    if (txnResult?.processor_response_code && txnResult.processor_response_code !== '000') {
      const code = txnResult.processor_response_code
      const msg = TRANZILA_CODE_MAP[code] || `Card declined (code: ${code})`
      console.log('[PARSE-ERROR] processor_response_code:', code, '→', msg)
      return msg
    }
    // Diners Club and some non-3DS cards return approved:false without a processor code
    if (txnResult?.approved === false) {
      const txnSt = typeof txnResult.status === 'string' ? txnResult.status : ''
      const msg = txnSt ? `Card declined by bank (${txnSt})` : 'Card declined by bank. Please contact your bank or try a different card.'
      console.log('[PARSE-ERROR] transaction_result.approved=false →', msg)
      return msg
    }
    if (Array.isArray(res.errors) && res.errors.length > 0) {
      const msg = res.errors.map((e: any) => e.message || e.code || 'Unknown').join(', ')
      console.log('[PARSE-ERROR] errors[] →', msg)
      return msg
    }
    if (res.Response && res.Response !== '000') {
      const msg = TRANZILA_CODE_MAP[res.Response] || `Transaction failed (code: ${res.Response})`
      console.log('[PARSE-ERROR] legacy Response:', res.Response, '→', msg)
      return msg
    }
    if (res.error && typeof res.error === 'string') { console.log('[PARSE-ERROR] error field →', res.error); return res.error }
    if (res.message && typeof res.message === 'string') { console.log('[PARSE-ERROR] message field →', res.message); return res.message }

    console.warn('[PARSE-ERROR] No pattern matched. Full result:', JSON.stringify(res))
    return 'Payment failed. Please try again or use a different card.'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isTzSuccess = useCallback((res: any): boolean => {
    if (!res) return false
    if (res.success === true) return true
    if (res.Response === '000') return true
    if (typeof res.error_code === 'number' && res.error_code === 0) {
      const txnResult = res.transaction_result
      if (txnResult) {
        // Diners Club (and other cards) can return approved:false without a processor code
        if (txnResult.approved === false) return false
        const pc = txnResult.processor_response_code
        const txnSt = typeof txnResult.status === 'string' ? txnResult.status.toLowerCase() : null
        if (pc && pc !== '000') return false
        // Require at least one positive signal — error_code:0 alone is not enough
        if (pc === '000' || txnResult.approved === true || txnResult.auth_number || txnSt === 'approved' || txnSt === 'success') return true
        return false
      }
      // No transaction_result: require a confirmation code
      if (res.ConfirmationCode || res.transaction_id || res.index) return true
      return false
    }
    // New API: status field
    if (typeof res.status === 'string') {
      const s = res.status.toLowerCase()
      if (s === 'success' || s === 'approved' || s === 'ok') return true
      if (s === 'failed' || s === 'error' || s === 'declined') return false
    }
    // processor_response_code at top level
    if (res.processor_response_code === '000') return true
    // Explicit bank/processor decline takes priority over ConfirmationCode presence.
    // Tranzila can return a non-empty ConfirmationCode even on declined transactions
    // (e.g. Diners Club refusals), so we must check decline codes first.
    if (res.Response && res.Response !== '000') return false
    if (res.processor_response_code && res.processor_response_code !== '000') return false
    if (res.transaction_result?.processor_response_code &&
      res.transaction_result.processor_response_code !== '000') return false
    // Also catch approved:false at the top-level transaction_result check
    if (res.transaction_result?.approved === false) return false
    // ConfirmationCode / transaction_id present → Tranzila approved the charge
    if (res.ConfirmationCode || res.transaction_id) return true
    // Nested transaction_response structure (new hosted-fields SDK response shape).
    // IMPORTANT: check success/processor_code BEFORE transaction_id — Tranzila returns
    // a transaction_id even for declined transactions (it is an internal reference, not an approval).
    if (res.transaction_response?.success === false) return false
    if (res.transaction_response?.processor_response_code &&
      res.transaction_response.processor_response_code !== '000') return false
    if (res.transaction_response?.success === true) return true
    if (res.transaction_response?.processor_response_code === '000') return true
    if (res.transaction_response?.transaction_id || res.transaction_response?.auth_number) return true
    return false
  }, [])

  const updateTranzilaSessionStatus = useCallback(async (sid: string, status: 'paid' | 'failed', errorCode?: string) => {
    try {
      console.log(`[STATUS-UPDATE] Updating session ${sid} to ${status}...`)
      const fd = new FormData()
      fd.append('Response', status === 'paid' ? '000' : (errorCode || '999'))
      fd.append('merchant_data', sid)
      // The callback API handles the Supabase update and error logging
      await fetch('/api/checkout/callback', { method: 'POST', body: fd })
    } catch (err) {
      console.error('[STATUS-UPDATE] Failed to update session status:', err)
    }
  }, [])

  const resetSession = useCallback(async (sid: string) => {
    try {
      console.log(`[SESSION-RESET] Resetting session ${sid}...`)
      await fetch('/api/checkout/session/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid })
      })
    } catch (err) {
      console.error('[SESSION-RESET] Failed to reset session:', err)
    }
  }, [])

  // ── Main submit handler ───────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const submitId = Math.random().toString(36).slice(2, 7)

    console.log(`[PAY][${submitId}] STEP 0 — handleSubmit called | method=${paymentMethod} | amount=${chargeAmount} | sessionId=${sessionId}`)

    if (isSubmittingRef.current) {
      console.warn(`[PAY][${submitId}] Already submitting, ignoring duplicate`)
      return
    }
    if (!validate()) {
      console.warn(`[PAY][${submitId}] Validation failed`)
      return
    }

    isSubmittingRef.current = true
    cancelledRef.current = false
    had3DSChallengeRef.current = false
    setIsSubmitting(true)
    setPaymentError(null)
    setLoadingStep('connecting')

    try {
      // ── STEP 1: Validate minimum amount for Bit ──────────────────────────
      if (paymentMethod === 'bit' && chargeAmount < 5) {
        const errorMsg = 'Bit requires a minimum payment of 5 NIS. Please use a credit card for this order.'
        console.log(`[PAY][${submitId}] STEP 1 — ❌ Bit amount too small: ${chargeAmount}`)
        setPaymentError(errorMsg)
        setIsSubmitting(false)
        isSubmittingRef.current = false
        return
      }

      // ── STEP 2: Call /api/checkout/charge ─────────────────────────────────
      // The server generates a FRESH thtk on each call — no client-side token needed.
      console.log(`[PAY][${submitId}] STEP 2 — Calling /api/checkout/charge (server will generate fresh thtk)...`)
      const response = await fetch('/api/checkout/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          customerInfo,
          installments: paymentMethod === 'card' ? installments : 1,
          paymentMethod,
          giftCardId: giftCardId || undefined,
          giftCardCode: giftCardCode || undefined,
          giftCardAmount: giftCardAmount || undefined,
          couponCode: couponCode || undefined,
          couponAmount: couponAmount || undefined,
          shippingFeeAmount: shippingFeeAmount || undefined,
          israeliId: israeliId || undefined,
          cardNumber: cardNumberOverride || undefined,
        }),
      })

      // ── STEP 2: Parse API response ────────────────────────────────────────
      console.log(`[PAY][${submitId}] STEP 2 — API HTTP status: ${response.status}`)
      const result = await response.json()
      console.log(`[PAY][${submitId}] STEP 2 — API response body:`, JSON.stringify(result))

      if (!response.ok) {
        console.error(`[PAY][${submitId}] STEP 2 — API returned error status ${response.status}`)
        setLoadingStep(null)
        setPaymentError(result.error || t('paymentForm.paymentRequestFailed'))
        setIsSubmitting(false)
        isSubmittingRef.current = false
        return
      }

      // ── STEP 3: 3DS redirect or Bit REST API redirect ─────────────────────
      const needs3DSModal = (result.requires3DS || result.requiresRedirect) && result.redirectUrl
      const needsBitRedirect = result.paymentMethod === 'bit' && !result.requiresHostedFields && result.redirectUrl
      if (needs3DSModal || needsBitRedirect) {
        console.log(`[PAY][${submitId}] STEP 3 — ${needsBitRedirect ? 'Bit REST redirect' : '3DS redirect'} | url: ${result.redirectUrl}`)
        setLoadingStep(null)
        // open3DSModal handles realtime + polling internally
        open3DSModal(result.redirectUrl, needsBitRedirect ? 'bit' : 'card', result.trackId)
        return
      }

      // ── STEP 4: Gift-card-only / test-card instant success ────────────────
      if (result.success && !result.requiresHostedFields) {
        console.log(`[PAY][${submitId}] STEP 4 — Instant success (GC-only or test card) | confirmationCode: ${result.confirmationCode}`)
        setLoadingStep(null)
        onSuccess(result.confirmationCode, result.shopifyOrderUrl, result.generatedGiftCards, result.giftCardRemainingBalance, giftCardCode)
        return
      }

      // ── STEP 5: Hosted Fields path (card + Bit) ───────────────────────────
      if (result.requiresHostedFields) {
        console.log(`[PAY][${submitId}] STEP 5 — requiresHostedFields=true | isBit=${!!result.isBit}`)
        console.log(`[PAY][${submitId}] STEP 5 — hostedFieldsRef.current: ${hostedFieldsRef.current ? 'READY' : 'NULL ⚠️'}`)
        console.log(`[PAY][${submitId}] STEP 5 — terminal="${result.terminal}" | thtk=${result.thtk ? 'present' : 'MISSING ⚠️'} | currency=${result.currency} | chargeAmount=${result.chargeAmount}`)

        const freshThtk = result.thtk ?? null
        console.log(`[THTK] Fresh server-generated thtk: ${freshThtk ? String(freshThtk).substring(0, 10) + '…' : 'MISSING ⚠️'}`)

        if (!hostedFieldsRef.current) {
          console.error(`[PAY][${submitId}] STEP 5 — ❌ Hosted fields NOT initialized! SDK may not have loaded yet.`)
          setPaymentError(t('paymentForm.paymentSystemNotReady'))
          setIsSubmitting(false)
          isSubmittingRef.current = false
          return
        }

        // ── STEP 6: Build params ────────────────────────────────────────────
        const isBitPayment = !!result.isBit

        // Map numeric Tranzila currency code to ISO for the new hosted fields API.
        // The server only ever returns '1' (ILS) or '2' (USD) — any other cart
        // currency is blocked or converted server-side before reaching here.
        if (result.currency !== '1' && result.currency !== '2') {
          console.error(`[PAY][${submitId}] Unexpected currency code from server: ${result.currency}`)
          setPaymentError(t('paymentForm.paymentSystemNotReady'))
          setIsSubmitting(false)
          isSubmittingRef.current = false
          return
        }
        const currencyIso = result.currency === '2' ? 'USD' : 'ILS'

        // Common base (same for card and Bit)
        const baseContact = {
          terminal_name: result.terminal,
          amount: Number(result.chargeAmount).toFixed(2),
          currency_code: currencyIso,
          contact: `${customerInfo.firstName} ${customerInfo.lastName}`,
          email: customerInfo.email,
          phone: customerInfo.phone.replace(/\D/g, ''),
          merchant_data: sessionId,
        }

        let tzParams: any  // card params for charge()
        let tzBitParams: any  // bit params for chargeBit()

        if (isBitPayment) {
          // chargeBit() params — Tranzila Bit API strictly requires these names:
          // terminal_name, amount, currency_code
          tzBitParams = {
            terminal_name: result.terminal,
            amount: Number(result.chargeAmount).toFixed(2),
            currency_code: 'ILS', // Bit only supports ILS
            contact: `${customerInfo.firstName} ${customerInfo.lastName}`,
            email: customerInfo.email,
            phone: customerInfo.phone.replace(/\D/g, ''),
            merchant_data: sessionId,
            success_url: result.callbackSuccessUrl,
            fail_url: result.callbackFailUrl,
            notify_url: result.callbackNotifyUrl,
          }
          if (result.thtk) tzBitParams.thtk = result.thtk
          console.log('Tranzila Bit Charge Payload:', tzBitParams)
          console.log(`[PAY][${submitId}] STEP 6 — Bit chargeBit() params:`, JSON.stringify({ ...tzBitParams, thtk: tzBitParams.thtk ? '***' : null }))
        } else {
          // charge() params for card
          tzParams = {
            ...baseContact,
            success_url_address: result.callbackUrl,
            fail_url_address: result.callbackUrl,
            payment_plan: installments > 1 ? installments : 1,
            tranmode: 'A',
          }
          if (customerInfo.nationalId) {
            tzParams.my_id = customerInfo.nationalId
            tzParams.myid = customerInfo.nationalId
          }
          if (result.thtk) tzParams.thtk = result.thtk
          if (installments > 1) {
            tzParams.npay = String(installments)
            const other = Math.floor((result.chargeAmount / installments) * 100) / 100
            const first = result.chargeAmount - other * (installments - 1)
            tzParams.fpay = String(first.toFixed(2))
            tzParams.spay = String(other.toFixed(2))
          }
          console.log('Tranzila Card Charge Payload:', tzParams)
          console.log(`[PAY][${submitId}] STEP 6 — Card charge() params:`, JSON.stringify({
            ...tzParams, thtk: tzParams.thtk ? `${String(tzParams.thtk).slice(0, 8)}…` : null,
          }))
        }

        // ── STEP 7: Start realtime + polling before charge ─────────────────
        console.log(`[PAY][${submitId}] STEP 7 — Starting realtime subscription + session polling`)
        startRealtimeSubscription()
        // For Bit, chargeBit() blocks until phone payment is done, so
        // polling starts immediately. Card: 15 s delay for callback round-trip.
        startSessionPolling(isBitPayment ? 0 : 15_000)
        is3DSActiveRef.current = true

        // ── STEP 7.5: Intercept SDK showChallenge ────────────────────────────
        // The SDK sends this when 3DS is required and opens the ACS challenge
        // page itself (popup or overlay). We just show a waiting spinner so the
        // user knows something is happening. We do NOT open another popup —
        // the SDK already handles the challenge UI.
        if (!isBitPayment) {
          const challengeHandler = (event: MessageEvent) => {
            let data = event.data
            try { if (typeof data === 'string') data = JSON.parse(data) } catch { }
            if (data?.type !== 'showChallenge') return

            console.log(`[PAY][${submitId}] showChallenge received — SDK is handling 3DS challenge UI`)
            window.removeEventListener('message', challengeHandler)
            challengeHandlerRef.current = null
            had3DSChallengeRef.current = true

            // Dismiss loader before showing 3DS overlay — they must never coexist
            setLoadingStep(null)
            setShow3DS(true)
          }
          challengeHandlerRef.current = challengeHandler
          window.addEventListener('message', challengeHandler)
        }

        // ── STEP 8: Call charge() or chargeBit() ──────────────────────────
        // Clear the 'connecting' loader: the SDK handles its own UI from here
        // (BIT: full-screen overlay; card: no UI until showChallenge or callback)
        setLoadingStep(null)
        if (isBitPayment) setIsBitQrActive(true)
        const sdkMethod = isBitPayment ? 'chargeBit' : 'charge'
        console.log(`[PAY][${submitId}] STEP 8 — Calling hostedFieldsRef.current.${sdkMethod}()...`)
        try {
          // SDK callback signature: (err, response)
          // success → err=null, response=<Tranzila response object>
          // failure → err={error:'bt_failed'} | false, response=<response or undefined>
          const sdkCall = isBitPayment
            ? (cb: any) => hostedFieldsRef.current.chargeBit(tzBitParams, cb)
            : (cb: any) => hostedFieldsRef.current.charge(tzParams, cb)
          sdkCall(async (err: any, response: any) => {
            // ── STEP 9: charge() / chargeBit() callback ─────────────────────
            // response = Tranzila API result on success; err = error indicator on failure
            const tzResult = response ?? err
            console.log(`[PAY][${submitId}] STEP 9 — SDK callback | err=${JSON.stringify(err)} | response=${JSON.stringify(response)}`)

            // Clean up 3DS challenge popup and handler now that SDK has responded
            if (challengeHandlerRef.current) {
              window.removeEventListener('message', challengeHandlerRef.current)
              challengeHandlerRef.current = null
            }
            if (popupMonitorRef.current) { clearInterval(popupMonitorRef.current); popupMonitorRef.current = null }
            if (popupRef.current && !popupRef.current.closed) { popupRef.current.close(); popupRef.current = null }
            setShow3DS(false)
            setThreeDSUrl('')

            const sdkSuccess = !err && isTzSuccess(tzResult)
            console.log(`[PAY][${submitId}] STEP 9 — sdkSuccess=${sdkSuccess} | isBit=${isBitPayment} | had3DS=${had3DSChallengeRef.current}`)
            console.log(`[PAY][${submitId}] STEP 9 — tzResult:`, JSON.stringify(tzResult))

            // ── Redirect to Shopify error page on explicit Tranzila failure ────
            // Only fires when processor_response_code is explicitly present and
            // not '000'. Undefined (success response without this field) is ignored.
            // if (tzResult?.processor_response_code && tzResult.processor_response_code !== '000') {
            //   console.log(`[PAY][${submitId}] STEP 9 — processor_response_code=${tzResult.processor_response_code} → redirecting to Shopify error page`)
            //   const errorMsg = encodeURIComponent(parseTranzilaError(tzResult, isBitPayment))
            //   resetSession(sessionId)
            //   window.location.href = `https://${shopDomain || 'rotmana.co'}/pages/error?message=${errorMsg}`
            //   return
            // }

            // ── Helper: redirect to success from session data ─────────────────
            const resolveSuccess = (sd: any) => {
              clearPoll(); clearListeners()
              setLoadingStep(null)
              setIsSubmitting(false); isSubmittingRef.current = false; is3DSActiveRef.current = false
              onSuccess(
                sd.tranzila_transaction_id || tzResult?.ConfirmationCode || tzResult?.index || 'confirmed',
                sd.raw_response?.shopifyOrderUrl,
                sd.raw_response?._generated_gift_cards,
                sd.raw_response?._gift_card?.remainingBalance,
                giftCardCode,
              )
            }

            // ── Helper: self-trigger callback so order+email are created ──────
            // Called when the SDK says the charge succeeded but the Tranzila
            // server-to-server callback hasn't updated the session yet (common
            // when the callback URL is behind a CDN, or the new hosted-fields API
            // skips the server callback entirely).
            const selfComplete = async (): Promise<boolean> => {
              try {
                const confirmationCode = String(
                  tzResult?.ConfirmationCode || tzResult?.transaction_result?.ConfirmationCode
                  || tzResult?.index || tzResult?.transaction_result?.index
                  || tzResult?.transaction_response?.transaction_id
                  || tzResult?.transaction_response?.auth_number
                  || `SDK-${Date.now()}`
                )
                let cbRes: Response
                if (isBitPayment) {
                  // For Bit: trigger the bit-callback success handler which also
                  // debits the gift card and sends the confirmation email.
                  cbRes = await fetch(
                    `/api/checkout/bit-callback/success?merchant_data=${encodeURIComponent(sessionId)}&index=${encodeURIComponent(confirmationCode)}`
                  )
                } else {
                  const fd = new FormData()
                  fd.append('Response', '000')
                  fd.append('index', confirmationCode)
                  fd.append('ConfirmationCode', confirmationCode)
                  fd.append('merchant_data', sessionId)
                  cbRes = await fetch('/api/checkout/callback', { method: 'POST', body: fd })
                }
                console.log(`[PAY][${submitId}] STEP 9 — self-callback HTTP ${cbRes.status}`)
                await new Promise(r => setTimeout(r, 800))
                const finalRes = await fetch(`/api/checkout/session?id=${sessionId}`)
                const finalData = finalRes.ok ? await finalRes.json() : null
                console.log(`[PAY][${submitId}] STEP 9 — post-self-callback session: "${finalData?.status}"`)
                if (finalData?.status === 'paid') { resolveSuccess(finalData); return true }
              } catch (e) {
                console.error(`[PAY][${submitId}] STEP 9 — self-callback error:`, e)
              }
              return false
            }

            // ── Session is the source of truth ────────────────────────────────
            try {
              const sessionRes = await fetch(`/api/checkout/session?id=${sessionId}`)
              const sessionData = sessionRes.ok ? await sessionRes.json() : null
              console.log(`[PAY][${submitId}] STEP 9 — session status: "${sessionData?.status}"`)

              if (sessionData?.status === 'paid') {
                console.log(`[PAY][${submitId}] STEP 9 — ✅ Session PAID → redirecting`)
                resolveSuccess(sessionData); return
              }

              if (sessionData?.status === 'failed') {
                const errMsg = sessionData.error_message || parseTranzilaError(tzResult, isBitPayment)
                console.log(`[PAY][${submitId}] STEP 9 — ❌ Session FAILED: "${errMsg}"`)
                clearListeners()
                setLoadingStep(null)
                setPaymentError(errMsg)
                setIsSubmitting(false); isSubmittingRef.current = false; is3DSActiveRef.current = false
                resetSession(sessionId)
                return
              }

              // ── Session still pending ──────────────────────────────────────
              // Self-complete only when there is strong evidence of a real charge:
              //   • sdkSuccess  — SDK confirmed payment (err=null + isTzSuccess=true)
              //   • ConfirmationCode / index present — Tranzila only sets these on success
              //
              // Intentionally excluded (unreliable / caused false orders):
              //   • had3DSChallengeRef.current — set when 3DS *starts*, not when it succeeds
              //   • (!err && !!response)       — any SDK response triggered selfComplete
              const sdkExplicitFailure = !!err && !response
              // A non-'000' response/processor code is an explicit bank decline (e.g. Diners Club
              // refusals). Guard approvalSignal so selfComplete() is never triggered for declines.
              const hasExplicitDecline = !!(
                (tzResult?.Response && tzResult.Response !== '000')
                || (tzResult?.processor_response_code && tzResult.processor_response_code !== '000')
                || (tzResult?.transaction_result?.processor_response_code &&
                  tzResult.transaction_result.processor_response_code !== '000')
                || tzResult?.transaction_result?.approved === false
                || tzResult?.transaction_response?.success === false
                || (tzResult?.transaction_response?.processor_response_code &&
                  tzResult.transaction_response.processor_response_code !== '000')
              )
              const approvalSignal = !sdkExplicitFailure && !hasExplicitDecline && (
                sdkSuccess                                    // Bit + card: SDK confirmed payment
                || (!isBitPayment && (                        // card-only: only hard proof
                  !!(tzResult?.ConfirmationCode || tzResult?.transaction_result?.ConfirmationCode)
                  || !!(tzResult?.index || tzResult?.transaction_result?.index)
                  || !!(tzResult?.transaction_response?.transaction_id || tzResult?.transaction_response?.auth_number)
                ))
              )

              console.log(`[PAY][${submitId}] STEP 9 — pending: approvalSignal=${approvalSignal} | sdkExplicitFailure=${sdkExplicitFailure} | had3DS=${had3DSChallengeRef.current} | isBit=${isBitPayment}`)

              if (approvalSignal) {
                // Charge was approved (or likely approved). Give Tranzila's server
                // callback 2 s to arrive before self-completing.
                setLoadingStep('completing')
                await new Promise(r => setTimeout(r, 2000))

                const recheck = await fetch(`/api/checkout/session?id=${sessionId}`)
                const recheckData = recheck.ok ? await recheck.json() : null
                console.log(`[PAY][${submitId}] STEP 9 — recheck: "${recheckData?.status}"`)

                if (recheckData?.status === 'paid') { resolveSuccess(recheckData); return }
                if (recheckData?.status === 'failed') {
                  clearListeners()
                  setLoadingStep(null)
                  setPaymentError(recheckData.error_message || parseTranzilaError(tzResult, isBitPayment))
                  setIsSubmitting(false); isSubmittingRef.current = false; is3DSActiveRef.current = false
                  resetSession(sessionId)
                  return
                }

                // Still pending. For card payments, verify authoritative result via track_id
                // before self-completing — this catches Diners Club declines that return a
                // ConfirmationCode but no explicit Response decline code in the SDK callback.
                if (!isBitPayment) {
                  const sdkTrackId = tzResult?.track_id || tzResult?.trackId
                  if (sdkTrackId) {
                    console.log(`[PAY][${submitId}] STEP 9 — still pending, verifying via track_id=${sdkTrackId} before self-complete`)
                    try {
                      const verifyRes = await fetch('/api/checkout/3ds-complete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ trackId: sdkTrackId, sessionId }),
                      })
                      const verifyData = verifyRes.ok ? await verifyRes.json() : null
                      console.log(`[PAY][${submitId}] STEP 9 — track_id verify result:`, JSON.stringify(verifyData))
                      if (verifyData?.success) {
                        clearPoll(); clearListeners()
                        setLoadingStep(null)
                        setIsSubmitting(false); isSubmittingRef.current = false; is3DSActiveRef.current = false
                        onSuccess(verifyData.confirmationCode || 'confirmed', verifyData.shopifyOrderUrl, verifyData.generatedGiftCards, verifyData.giftCardRemainingBalance, giftCardCode)
                        return
                      }
                      if (verifyData && !verifyData.pending) {
                        clearListeners()
                        setLoadingStep(null)
                        setPaymentError(verifyData.error || parseTranzilaError(tzResult, isBitPayment))
                        setIsSubmitting(false); isSubmittingRef.current = false; is3DSActiveRef.current = false
                        resetSession(sessionId)
                        return
                      }
                      // verifyData.pending → still in flight, fall through to selfComplete
                    } catch (verifyErr) {
                      console.error(`[PAY][${submitId}] STEP 9 — track_id verify error (will attempt selfComplete):`, verifyErr)
                    }
                  }
                }

                // Server callback is not coming. Self-trigger the full
                // post-payment flow (Shopify order + email + session → paid).
                console.log(`[PAY][${submitId}] STEP 9 — still pending after 2 s → self-completing`)
                const done = await selfComplete()
                if (done) return
                // selfComplete failed (very rare) — fall through to polling
              }

              // ── 3DS not validated, explicit SDK failure, or explicit bank decline ───
              // Covers: 3DS challenge not completed, SDK error flag, or a non-'000'
              // response code (e.g. Diners Club refusals that carry a ConfirmationCode
              // but still have a decline code in Response/processor_response_code).
              if (had3DSChallengeRef.current || sdkExplicitFailure || hasExplicitDecline) {
                console.log(`[PAY][${submitId}] STEP 9 — 3DS not validated / SDK failure / explicit decline → showing error`)
                clearListeners()
                setLoadingStep(null)
                setPaymentError(parseTranzilaError(tzResult, isBitPayment))
                setIsSubmitting(false); isSubmittingRef.current = false; is3DSActiveRef.current = false
                resetSession(sessionId)
                return
              }

              // ── 3DS didn't launch: verify directly via track_id ───────────────
              // Tranzila always assigns a track_id even when no challenge is shown
              // (frictionless / non-enrolled cards). Call 3ds-complete to get the
              // authoritative transaction result and update Supabase accordingly.
              if (!isBitPayment) {
                const sdkTrackId = tzResult?.track_id || tzResult?.trackId
                if (sdkTrackId) {
                  console.log(`[PAY][${submitId}] STEP 9 — no 3DS challenge, track_id=${sdkTrackId} → verifying with Tranzila`)
                  setLoadingStep('completing')
                  try {
                    const verifyRes = await fetch('/api/checkout/3ds-complete', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ trackId: sdkTrackId, sessionId }),
                    })
                    const verifyData = verifyRes.ok ? await verifyRes.json() : null
                    console.log(`[PAY][${submitId}] STEP 9 — verify result:`, JSON.stringify(verifyData))

                    if (verifyData?.success) {
                      clearPoll(); clearListeners()
                      setLoadingStep(null)
                      setIsSubmitting(false); isSubmittingRef.current = false; is3DSActiveRef.current = false
                      onSuccess(
                        verifyData.confirmationCode || 'confirmed',
                        verifyData.shopifyOrderUrl,
                        verifyData.generatedGiftCards,
                        verifyData.giftCardRemainingBalance,
                        giftCardCode,
                      )
                      return
                    }
                    if (verifyData && !verifyData.pending) {
                      clearListeners()
                      setLoadingStep(null)
                      setPaymentError(verifyData.error || parseTranzilaError(tzResult, isBitPayment))
                      setIsSubmitting(false); isSubmittingRef.current = false; is3DSActiveRef.current = false
                      resetSession(sessionId)
                      return
                    }
                    // verifyData.pending → transaction still in flight, use active polling
                    clearPoll()
                    start3DSActivePolling(sdkTrackId)
                    return
                  } catch (verifyErr) {
                    console.error(`[PAY][${submitId}] STEP 9 — track_id verify error:`, verifyErr)
                    // Fall through to session polling
                  }
                }
              }

              // Bit payment or no track_id: keep polling; the notify webhook may still arrive.
              console.log(`[PAY][${submitId}] STEP 9 — falling back to immediate polling (approvalSignal=${approvalSignal})`)
              setLoadingStep('completing')
              clearPoll()
              startSessionPolling(0)

            } catch (sessionCheckErr) {
              console.error(`[PAY][${submitId}] STEP 9 — session check error:`, sessionCheckErr)
              if (!sdkSuccess) {
                clearListeners()
                setLoadingStep(null)
                setPaymentError(parseTranzilaError(tzResult, isBitPayment))
                setIsSubmitting(false); isSubmittingRef.current = false; is3DSActiveRef.current = false
              }
              // sdkSuccess=true → polling/realtime still running, will catch paid state
            }
          })
          console.log(`[PAY][${submitId}] STEP 8 — ${sdkMethod}() called (callback pending until payment completes)`)
        } catch (err: any) {
          console.error(`[PAY][${submitId}] STEP 8 — ❌ Exception thrown by ${sdkMethod}():`, err?.message || err)
          setLoadingStep(null)
          setPaymentError(t('paymentForm.paymentInitFailed'))
          setIsSubmitting(false)
          isSubmittingRef.current = false
          is3DSActiveRef.current = false
          clearListeners()
        }
        return
      }

      // ── Fallback: unexpected response shape ──────────────────────────────
      console.error(`[PAY][${submitId}] STEP ? — Unexpected API response (no requiresHostedFields, no success, no redirect):`, JSON.stringify(result))
      setPaymentError(result.error || t('paymentForm.paymentFailed'))

    } catch (err: any) {
      console.error(`[PAY][${submitId}] CATCH — Unhandled exception:`, err?.message || err)
      setLoadingStep(null)
      setPaymentError(t('paymentForm.paymentProcessingFailed'))
    } finally {
      if (!is3DSActiveRef.current) {
        console.log(`[PAY][${submitId}] FINALLY — Not in 3DS/HF active state, resetting submit lock`)
        setLoadingStep(null)
        setIsSubmitting(false)
        isSubmittingRef.current = false
      }
    }
  }

  // ── Formatters ────────────────────────────────────────────────────────────

  const formatPrice = (amount: number) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency: displayCurrency || currency }).format(amount * displayRate)

  const perInstallment = installments > 1 ? chargeAmount / installments : chargeAmount

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <Script
        src="https://hf.tranzila.com/assets/js/thostedf.js"
        strategy="afterInteractive"
        onLoad={() => {
          console.log(`[TZ] SDK loaded. Initializing Hosted Fields (thtk will be generated fresh at charge time)...`)
          tzLoaded.current = true
          initTranzila()
        }}
      />

      {/*
        FIX 1 + 2: Global style for Tranzila-injected iframes.
        Without this, the iframes Tranzila injects have no explicit dimensions
        and are NOT clickable. This forces them to fill their container div
        and sets pointer-events: auto so clicks reach the iframe document.
      */}
      <style>{`
        /* Card hosted-field iframes must fill their container and be clickable */
        #credit_card_number iframe,
        #cvv iframe,
        #expiry iframe {
          display: block !important;
          width: 100% !important;
          height: 100% !important;
          pointer-events: auto !important;
          border: none !important;
        }
        #credit_card_number, #cvv, #expiry {
          cursor: text;
          pointer-events: auto;
        }
      `}</style>

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
          <button onClick={onBack} className="bg-transparent text-sm text-foreground underline hover:no-underline">
            {t('paymentForm.change')}
          </button>
        </div>
      </div>

      {/* Coupon Code Section */}
      <CouponForm
        currency={currency}
        displayCurrency={displayCurrency}
        displayRate={displayRate}
        orderTotal={total}
        shopifyDiscount={shopifyDiscount}
        appliedCoupon={appliedCoupon}
        onApply={onCouponApply}
        onRemove={onCouponRemove}
      />

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
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${paymentMethod === 'card'
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
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${paymentMethod === 'bit'
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

            {/* Card logos — shown below tabs when card is selected */}
            {paymentMethod === 'card' && (
              <div className="flex items-center justify-start gap-2 mb-4">
                <Image src="/visa.png" alt="Visa" width={50} height={26} style={{ objectFit: 'contain', height: 22 }} />
                <Image src="/master.png" alt="Mastercard" width={50} height={26} style={{ objectFit: 'contain', height: 22 }} />
                <Image src="/amex.png" alt="Amex" width={60} height={26} style={{ objectFit: 'contain', height: 22 }} />
                <Image src="/Diners_Club_Logo.svg" alt="Diners" width={65} height={26} style={{ objectFit: 'contain', height: 22 }} />
              </div>
            )}

            {/* ── Card section — always in DOM, visible only when card is selected ── */}
            <div style={{ display: paymentMethod === 'card' ? 'block' : 'none' }}>
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-muted/50 px-4 py-3 flex items-center justify-between border-b border-border">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-foreground" />
                    <span className="text-sm font-medium text-foreground">{t('paymentForm.creditCardLower')}</span>
                  </div>
                </div>

                <div className="p-4 space-y-4 bg-background">
                  <div className="space-y-4">


                    {lang === 'he' && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1">
                            {t('paymentForm.cardNumber') || 'Card Number'}
                          </label>
                          {/* Tranzila iframe — real card mode */}
                          <div
                            id="credit_card_number"
                            className="h-11 rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring transition-shadow w-full relative overflow-hidden"
                            style={{ minHeight: '44px', display: showTestCardInput ? 'none' : 'block' }}
                          />
                          {/* Plain text input — test card mode */}
                          {showTestCardInput && (
                            <input
                              type="text"
                              value={cardNumberOverride}
                              onChange={(e) => setCardNumberOverride(e.target.value)}
                              placeholder="5430050220380520"
                              maxLength={19}
                              className={`h-11 px-3 rounded-lg border font-mono tracking-widest focus:outline-none focus:ring-2 transition-shadow w-full bg-background text-foreground ${isTestCardActive ? 'border-green-500 bg-green-50 dark:bg-green-900/20 focus:ring-green-500' : 'border-input focus:ring-ring'}`}
                            />
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1">
                            {t('customerForm.nationalId')} <span className="text-destructive">*</span>
                          </label>
                          <input
                            type="text"
                            value={israeliId}
                            onChange={(e) => {
                              setIsraeliId(e.target.value)
                              if (errors.israeliId) setErrors(prev => ({ ...prev, israeliId: '' }))
                            }}
                            className={`h-11 px-3 rounded-lg border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow w-full ${errors.israeliId ? 'border-destructive' : 'border-input'}`}
                            maxLength={9}
                          />
                          {errors.israeliId && (
                            <p className="mt-1 text-xs text-destructive">{errors.israeliId}</p>
                          )}
                        </div>
                      </div>
                    )}
                    {lang === 'en' && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                          {t('paymentForm.cardNumber') || 'Card Number'}
                        </label>
                        {/* Tranzila iframe — real card mode */}
                        <div
                          id="credit_card_number"
                          className="h-11 rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring transition-shadow w-full relative overflow-hidden"
                          style={{ minHeight: '44px', display: showTestCardInput ? 'none' : 'block' }}
                        />
                        {/* Plain text input — test card mode */}
                        {showTestCardInput && (
                          <input
                            type="text"
                            value={cardNumberOverride}
                            onChange={(e) => setCardNumberOverride(e.target.value)}
                            placeholder="5430050220380520"
                            maxLength={19}
                            className={`h-11 px-3 rounded-lg border font-mono tracking-widest focus:outline-none focus:ring-2 transition-shadow w-full bg-background text-foreground ${isTestCardActive ? 'border-green-500 bg-green-50 dark:bg-green-900/20 focus:ring-green-500' : 'border-input focus:ring-ring'}`}
                          />
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                          {t('paymentForm.expiryDate') || 'Expiry Date'}
                        </label>
                        <div
                          id="expiry"
                          className="h-11 rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring transition-shadow w-full relative overflow-hidden"
                          style={{ minHeight: '44px' }}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                          {t('paymentForm.cvvPlaceholder') || 'CVV'}
                        </label>
                        <div
                          id="cvv"
                          className="h-11 rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring transition-shadow w-full relative overflow-hidden"
                          style={{ minHeight: '44px' }}
                        />
                      </div>
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
            </div>

            {/* ── Test card toggle (card mode only) ── */}
            {/* {paymentMethod === 'card' && (
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowTestCardInput(v => !v)
                    setCardNumberOverride('')
                  }}
                  className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  {showTestCardInput ? '← Real card' : 'Test card'}
                </button>
              </div>
            )} */}

            {/* ── Bit section ── */}
            {/* Clicking "Pay with Bit" calls chargeBit() which makes the SDK
                show a full-screen overlay with the Bit QR / deeplink.
                No hosted-field container is needed here. */}
            <div style={{ display: paymentMethod === 'bit' ? 'block' : 'none' }}>
              <div className="rounded-xl border-2 border-[#2b5686] bg-gradient-to-b from-[#2b5686]/5 to-[#2eb3b8]/5 p-6">
                <div className="flex items-center justify-center gap-3">
                  <div className="flex items-center justify-center h-14 w-14 rounded-full bg-gradient-to-b from-[#2b5686] to-[#2eb3b8] shadow-md">
                    <Image src="/bit.png" alt="Bit" width={36} height={22} style={{ objectFit: 'contain' }} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">{t('paymentForm.payWithBitTitle')}</h3>
                    <p className="text-xs text-muted-foreground">{t('paymentForm.bitDescription')}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
        }

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
              onChange={e => setTermsAccepted(e.target.checked)}
              className="w-4 h-4 text-primary border-2 border-input rounded focus:ring-2 focus:ring-ring bg-background"
            />
            <label htmlFor="terms" className="text-sm text-muted-foreground">
              {t('paymentForm.agreeTerms')}{' '}
              <button
                type="button"
                onClick={() => setShowTerms(!showTerms)}
                className="text-primary hover:underline underline-offset-2"
              >
                {t('paymentForm.theTerms')}
              </button>
            </label>
          </div>
          {errors.terms && (
            <p className="mt-1 text-sm text-destructive">{errors.terms}</p>
          )}
        </div>

        {/* Payment Method Specific Errors */}
        {
          errors.card && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{errors.card}</p>
            </div>
          )
        }

        {
          errors.installments && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{errors.installments}</p>
            </div>
          )
        }

        {
          errors.bit && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{errors.bit}</p>
            </div>
          )
        }

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
            className={`w-full sm:flex-1 py-4 px-6 rounded-lg font-semibold text-base transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${paymentMethod === 'bit'
              ? 'bg-gradient-to-b from-[#2b5686] to-[#2eb3b8] text-white hover:opacity-90 focus:ring-[#2b5686]'
              : 'bg-[#7c7a7a45] text-gray-700 hover:opacity-90 focus:ring-ring'
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
      </form >

      {/* Mini banner — shown when 3DS popup window is open (no overlay, no loader) */}
      {
        popupWindowActive && (
          <div className="fixed bottom-6 inset-x-0 flex justify-center z-[100] px-4 pointer-events-none">
            <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 px-5 py-4 flex items-center gap-4 max-w-sm w-full pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="h-8 w-8 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {paymentMethod === 'bit' ? t('paymentForm.bitVerification') : t('paymentForm.securePayment')}
                </p>
                <p className="text-xs text-gray-400 truncate">{t('paymentForm.completeInPopup')}</p>
              </div>
              <button
                onClick={() => close3DS('User Cancel')}
                aria-label="Close"
                className="flex-shrink-0 h-7 w-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          </div>
        )
      }

      {/* ── Bit QR close button + backdrop ── */}
      {
        isBitQrActive && (
          <>
            {/* Dark backdrop to frame the SDK's QR overlay */}
            <div className="fixed inset-0 z-[99997] bg-black/60 backdrop-blur-sm" />
            {/* Close button anchored near the top-right of the centered QR card */}
            <button
              onClick={() => {
                // Best-effort: remove any SDK-injected fixed/absolute overlay from body
                const appRoot = document.getElementById('__next') ?? document.body.firstElementChild
                Array.from(document.body.children).forEach(el => {
                  if (el === appRoot) return
                  const s = window.getComputedStyle(el)
                  if (s.position === 'fixed' || s.position === 'absolute') el.remove()
                })
                close3DS('User Cancel')
              }}
              aria-label="Close Bit payment"
              className="fixed z-[99999] top-1/2 left-1/2 -translate-y-[195px] translate-x-[135px] flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-lg text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </>
        )
      }

      {/* ── Loader overlay — connecting / completing (never shown alongside 3DS) ── */}
      {
        !!loadingStep && !show3DS && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-xs bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className={`h-1 w-full bg-gradient-to-r ${loadingStep === 'completing' ? 'from-emerald-400 via-teal-500 to-emerald-500' : 'from-blue-500 via-indigo-500 to-violet-500'}`} />
              <div className="px-8 py-10 text-center space-y-5">
                <div className={`mx-auto h-14 w-14 rounded-full border-4 border-gray-100 animate-spin ${loadingStep === 'completing' ? 'border-t-emerald-500' : 'border-t-blue-500'}`} />
                <div className="space-y-1.5">
                  <p className="text-base font-bold text-gray-900">
                    {loadingStep === 'completing'
                      ? t('paymentForm.loadingCompleting')
                      : paymentMethod === 'bit'
                        ? t('paymentForm.loadingConnectingBit')
                        : t('paymentForm.loadingConnecting')}
                  </p>
                  <p className="text-sm text-gray-400 leading-relaxed">
                    {loadingStep === 'completing'
                      ? t('paymentForm.loadingCompletingSubtitle')
                      : t('paymentForm.loadingConnectingSubtitle')}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <div className={`h-1.5 w-1.5 rounded-full animate-pulse ${loadingStep === 'completing' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                  <span className="text-xs text-gray-400">{t('paymentForm.verifying')}</span>
                </div>
                {loadingStep !== 'completing' && (
                  <button onClick={() => close3DS('User Cancel')} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                    {t('paymentForm.cancel')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      }

      {/* ── 3DS SDK challenge overlay — SDK handles its own UI, we show a waiting screen ── */}
      {
        show3DS && !threeDSUrl && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => close3DS('User Cancel')}>
            <div className="relative w-full max-w-sm mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />
              <button
                onClick={() => close3DS('User Cancel')}
                className="absolute top-3 right-3 h-7 w-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors text-xs font-bold"
                aria-label="Close"
              >
                ✕
              </button>
              <div className="px-8 py-10 text-center space-y-6">
                {/* Shield icon */}
                <div className="mx-auto h-16 w-16 rounded-full bg-blue-50 border-2 border-blue-100 flex items-center justify-center">
                  <Shield className="h-8 w-8 text-blue-600" />
                </div>
                <div className="space-y-2">
                  <p className="text-lg font-bold text-gray-900">
                    {t('paymentForm.securePayment')}
                  </p>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {t('paymentForm.verifyingPayment')}
                  </p>
                </div>
                {/* Animated dots */}
                <div className="flex items-center justify-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <button onClick={() => close3DS('User Cancel')} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                  {t('paymentForm.cancel')}
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* ── Iframe fallback — popup was blocked, 3DS/Bit shown inline ── */}
      {
        show3DS && threeDSUrl && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => close3DS('User Cancel')}>
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <Shield className="h-3.5 w-3.5 text-blue-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {paymentMethod === 'bit' ? t('paymentForm.bitVerification') : t('paymentForm.securePayment')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-xs text-gray-400">{t('paymentForm.verifying')}</span>
                  </div>
                  <button
                    onClick={() => close3DS('User Cancel')}
                    className="h-7 w-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors text-xs font-bold"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <iframe
                src={threeDSUrl}
                className="w-full border-0"
                style={{ height: '520px' }}
                title={paymentMethod === 'bit' ? 'Bit Payment' : '3D Secure Verification'}
              />
            </div>
          </div>
        )
      }

      {/* Payment Error Popup */}
      {
        !show3DS && !popupWindowActive && paymentError && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center sm:bg-black/60 px-4" dir={dir}>
            {/* Mobile background image */}
            <Image
              src="/checkout/error-image.jpg"
              alt=""
              fill
              className="sm:hidden object-cover object-center"
            />
            <div className="sm:hidden absolute inset-0 bg-black/30" />

            <div
              className="relative flex w-full overflow-hidden bg-white shadow-2xl"
              style={{ maxWidth: 560, borderRadius: 2 }}
            >
              {/* Left: product image - desktop only */}
              <div className="relative hidden sm:block" style={{ width: '44%', minHeight: 380, flexShrink: 0 }}>
                <Image
                  src="/checkout/error-image.jpg"
                  alt=""
                  fill
                  className="object-cover object-center"
                />
              </div>

              {/* Right: content */}
              <div className="flex flex-1 flex-col items-center justify-center bg-white px-10 py-10 text-center relative">
                {/* Close button */}
                <button
                  onClick={() => setPaymentError(null)}
                  aria-label="Close"
                  className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>

                {/* Title */}
                <h3
                  className="text-[2.4rem] leading-[1.1] text-gray-900 mb-4"
                  style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic' }}
                >
                  {t('errorModal.title')}
                </h3>

                {/* Body */}
                <p className="text-[0.8rem] text-gray-500 leading-relaxed mb-6 whitespace-pre-line" style={{ maxWidth: 195 }}>
                  {t('errorModal.body')}
                </p>

                {/* Try again CTA */}
                <button
                  onClick={() => setPaymentError(null)}
                  className="text-[0.82rem] text-gray-900 underline underline-offset-2 hover:opacity-60 transition-opacity mb-3"
                >
                  {t('errorModal.cta')}
                </button>

                {/* Return to store */}
                <a
                  href={storeUrl(lang)}
                  className="text-[0.72rem] uppercase tracking-[0.15em] text-gray-400 hover:text-gray-700 transition-colors"
                >
                  {t('paymentForm.returnToStore')}
                </a>
              </div>
            </div>
          </div>
        )
      }

      {/* Terms Modal */}
      {
        showTerms && (
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
        )
      }
    </div >
  )
}

function CardBrand({ type }: { type: string }) {
  const brands: Record<string, { bg: string; text: string; src?: string }> = {
    visa: { bg: 'transparent', text: 'VISA', src: '/visa.png' },
    mastercard: { bg: 'transparent', text: 'MC', src: '/master.png' },
    discover: { bg: 'transparent', text: 'DISC', src: '/discover.jpg' },
    amex: { bg: 'transparent', text: 'AMEX', src: '/amex.png' },
    diners: { bg: 'transparent', text: 'DINERS', src: '/Diners_Club_Logo.svg' },
    generic: { bg: 'bg-muted', text: 'generic' },
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