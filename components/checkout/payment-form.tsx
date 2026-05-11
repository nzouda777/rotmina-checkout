'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, CreditCard, Lock, Shield, Info } from 'lucide-react'
import type { CustomerInfo } from '@/lib/types'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { RealtimeChannel } from '@supabase/supabase-js'
import Image from 'next/image'
import Script from 'next/script'
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
  shopDomain,
  onBack,
  onSuccess,
  onError,
  onProcessing,
  giftCardId,
  giftCardCode,
  giftCardAmount = 0,
}: PaymentFormProps) {
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
  const isSubmittingRef   = useRef(false)
  const tzLoaded          = useRef(false)
  const is3DSActiveRef    = useRef(false)
  const cancelledRef      = useRef(false)
  const channelRef        = useRef<RealtimeChannel | null>(null)
  const pollIntervalRef   = useRef<NodeJS.Timeout | null>(null)
  const pollTimeoutRef    = useRef<NodeJS.Timeout | null>(null)
  const messageHandlerRef = useRef<((e: MessageEvent) => void) | null>(null)

  // FIX 5: hostedFields as a ref instead of state.
  // Using useState caused re-renders that could trigger re-initialization
  // loops and stale closure captures in charge callbacks.
  const hostedFieldsRef   = useRef<any>(null)

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
            cvv:                { selector: '#cvv' },
            expiry:             { selector: '#expiry' },
          },
        }
        // No thtk at create() time — Tranzila confirmed that thtk should be
        // generated fresh server-side at charge time. The SDK is initialized
        // without a token; the fresh thtk will be passed to charge()/chargeBit().
        console.log(`[TZ] Calling create() without thtk (will be generated fresh at charge time)`)

        // @ts-ignore
        const instance = window.TzlaHostedFields.create(sdkConfig)
        console.log('instance',instance)
        console.log('sdkConfig',sdkConfig)
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
      // Check if hosted fields are initialized
      if (!hostedFieldsRef.current) {
        newErrors.card = 'Payment system is not ready. Please wait a moment and try again.'
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
          const res  = await fetch(`/api/checkout/session?id=${sessionId}`)
          if (!res.ok) return
          const data = await res.json()

          console.log(`[POLL] Session status: ${data.status} | error_message: ${data.error_message ?? 'none'}`)

          if (data.status === 'paid') {
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
    setThreeDSUrl(redirectUrl)
    setShow3DS(true)

    startRealtimeSubscription()

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

      await new Promise(r => setTimeout(r, 800))

      let sessionData: any = null
      try {
        const res  = await fetch(`/api/checkout/session?id=${sessionId}`)
        sessionData = res.ok ? await res.json() : null

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
      } catch {}

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
    const txnResult = res.transaction_result
    if (txnResult?.processor_response_code && txnResult.processor_response_code !== '000') {
      const code = txnResult.processor_response_code
      const msg = TRANZILA_CODE_MAP[code] || `Card declined (code: ${code})`
      console.log('[PARSE-ERROR] processor_response_code:', code, '→', msg)
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
    if (
      typeof res.error_code === 'number' &&
      res.error_code === 0 &&
      (!res.transaction_result || res.transaction_result.processor_response_code === '000')
    ) return true
    return false
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
    setIsSubmitting(true)
    setPaymentError(null)

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
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sessionId,
          customerInfo,
          installments:   paymentMethod === 'card' ? installments : 1,
          paymentMethod,
          giftCardId:     giftCardId   || undefined,
          giftCardCode:   giftCardCode || undefined,
          giftCardAmount: giftCardAmount || undefined,
        }),
      })

      // ── STEP 2: Parse API response ────────────────────────────────────────
      console.log(`[PAY][${submitId}] STEP 2 — API HTTP status: ${response.status}`)
      const result = await response.json()
      console.log(`[PAY][${submitId}] STEP 2 — API response body:`, JSON.stringify(result))

      if (!response.ok) {
        console.error(`[PAY][${submitId}] STEP 2 — API returned error status ${response.status}`)
        setPaymentError(result.error || 'Payment request failed. Please try again.')
        setIsSubmitting(false)
        isSubmittingRef.current = false
        return
      }

      // ── STEP 3: 3DS redirect or Bit REST API redirect ─────────────────────
      const needs3DSModal = (result.requires3DS || result.requiresRedirect) && result.redirectUrl
      const needsBitRedirect = result.paymentMethod === 'bit' && !result.requiresHostedFields && result.redirectUrl
      if (needs3DSModal || needsBitRedirect) {
        console.log(`[PAY][${submitId}] STEP 3 — ${needsBitRedirect ? 'Bit REST redirect' : '3DS redirect'} | url: ${result.redirectUrl}`)
        // open3DSModal handles realtime + polling internally
        open3DSModal(result.redirectUrl, needsBitRedirect ? 'bit' : 'card', result.trackId)
        return
      }

      // ── STEP 4: Gift-card-only / test-card instant success ────────────────
      if (result.success && !result.requiresHostedFields) {
        console.log(`[PAY][${submitId}] STEP 4 — Instant success (GC-only or test card) | confirmationCode: ${result.confirmationCode}`)
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
          setPaymentError('Payment system is not ready. Please wait a moment and try again.')
          setIsSubmitting(false)
          isSubmittingRef.current = false
          return
        }

        // ── STEP 6: Build params ────────────────────────────────────────────
        const isBitPayment = !!result.isBit

        // Common base (same for card and Bit)
        const baseContact = {
          terminal:      result.terminal,
          terminal_name: result.terminal,
          sum:           String(result.chargeAmount),
          currency:      result.currency,
          contact:       `${customerInfo.firstName} ${customerInfo.lastName}`,
          email:         customerInfo.email,
          phone:         customerInfo.phone.replace(/\D/g, ''),
          merchant_data: sessionId,
        }

        let tzParams: any  // card params for charge()
        let tzBitParams: any  // bit params for chargeBit()

        if (isBitPayment) {
          // chargeBit() params — Tranzila Bit API strictly requires these names:
          // terminal_name, amount, currency_code
          tzBitParams = {
            terminal_name:      result.terminal,
            amount:             String(result.chargeAmount),
            currency_code:      'ILS', // Bit only supports ILS
            contact:            `${customerInfo.firstName} ${customerInfo.lastName}`,
            email:              customerInfo.email,
            phone:              customerInfo.phone.replace(/\D/g, ''),
            merchant_data:      sessionId,
            success_url:        result.callbackSuccessUrl,
            fail_url:           result.callbackFailUrl,
            notify_url:         result.callbackNotifyUrl,
          }
          if (result.thtk) tzBitParams.thtk = result.thtk
          console.log(`[PAY][${submitId}] STEP 6 — Bit chargeBit() params:`, JSON.stringify({ ...tzBitParams, thtk: tzBitParams.thtk ? '***' : null }))
        } else {
          // charge() params for card
          tzParams = {
            ...baseContact,
            success_url_address: result.callbackUrl,
            fail_url_address:    result.callbackUrl,
            cred_type: installments > 1 ? '8' : '1',
            tranmode:  'A',
          }
          if (result.thtk) tzParams.thtk = result.thtk
          if (installments > 1) {
            tzParams.npay = String(installments)
            const other = Math.floor((result.chargeAmount / installments) * 100) / 100
            const first = result.chargeAmount - other * (installments - 1)
            tzParams.fpay = String(first.toFixed(2))
            tzParams.spay = String(other.toFixed(2))
          } else {
            tzParams.maxpay = '1'
          }
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

        // ── STEP 8: Call charge() or chargeBit() ──────────────────────────
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

            // success = err is null/falsy AND response indicates approval
            const success = !err && isTzSuccess(tzResult)
            console.log(`[PAY][${submitId}] STEP 9 — success: ${success} | isBit: ${isBitPayment}`)

            if (success) {
              // SDK confirmed the charge. For card, the backend callback updates
              // the session. For Bit, chargeBit() fires only after the user completes
              // payment on their phone. In both cases, the notify webhook may have
              // already marked it paid.
              //
              // Strategy: Check session immediately to see if we can redirect now.
              console.log(`[PAY][${submitId}] STEP 9 — ✅ ${isBitPayment ? 'Bit' : 'Card'} charge accepted — checking session for immediate redirect...`)
              
              try {
                const sessionRes = await fetch(`/api/checkout/session?id=${sessionId}`)
                const sessionData = sessionRes.ok ? await sessionRes.json() : null

                if (sessionData?.status === 'paid') {
                  console.log(`[PAY][${submitId}] STEP 9 — ✅ Session already PAID — redirecting immediately`)
                  clearPoll()
                  clearListeners()
                  setIsSubmitting(false)
                  isSubmittingRef.current = false
                  is3DSActiveRef.current = false
                  onSuccess(
                    sessionData.tranzila_transaction_id || 'confirmed',
                    sessionData.raw_response?.shopifyOrderUrl,
                    sessionData.raw_response?._generated_gift_cards,
                    sessionData.raw_response?._gift_card?.remainingBalance,
                    giftCardCode,
                  )
                  return
                }
                console.log(`[PAY][${submitId}] STEP 9 — Session not yet paid, waiting for polling/realtime to finish`)
              } catch (err) {
                console.error(`[PAY][${submitId}] STEP 9 — Immediate session check failed:`, err)
              }
            } else if (isBitPayment) {
              // ── Bit-specific: SDK callback is unreliable for Bit ───────────
              // The chargeBit() SDK callback frequently returns an error/non-success
              // response even when the payment actually succeeded. The Tranzila
              // notify webhook (server-to-server) is the authoritative signal —
              // it may have already marked the session as "paid" by the time this
              // callback fires.
              //
              // Strategy:
              //   1. Check the session status immediately.
              //   2. If already "paid" → redirect to success.
              //   3. If still processing → keep polling/realtime alive for a grace
              //      period to allow the webhook to arrive.
              //   4. Only show an error if the session is explicitly "failed".
              console.log(`[PAY][${submitId}] STEP 9 — Bit SDK callback non-success, checking session before showing error...`)

              try {
                const sessionRes = await fetch(`/api/checkout/session?id=${sessionId}`)
                const sessionData = sessionRes.ok ? await sessionRes.json() : null

                if (sessionData?.status === 'paid') {
                  console.log(`[PAY][${submitId}] STEP 9 — ✅ Bit session already PAID (notify webhook arrived) — redirecting to success`)
                  clearPoll()
                  clearListeners()
                  setIsSubmitting(false)
                  isSubmittingRef.current = false
                  is3DSActiveRef.current = false
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
                  console.log(`[PAY][${submitId}] STEP 9 — ❌ Bit session explicitly FAILED: "${sessionData.error_message}"`)
                  clearListeners()
                  setPaymentError(sessionData.error_message || parseTranzilaError(tzResult, true))
                  setIsSubmitting(false)
                  isSubmittingRef.current = false
                  is3DSActiveRef.current = false
                  return
                }

                // Session is still in a transitional state (pending_bit / processing).
                // The notify webhook may not have arrived yet. Keep polling/realtime
                // alive — they will detect the final status and redirect or show error.
                console.log(`[PAY][${submitId}] STEP 9 — Bit session status="${sessionData?.status}" — keeping polling alive (notify webhook may still arrive)`)
                // Don't clear listeners, don't show error, don't reset submit state.
                // The existing polling (startSessionPolling) and realtime subscription
                // will handle the final redirect.
              } catch (checkErr) {
                console.error(`[PAY][${submitId}] STEP 9 — Failed to check session status:`, checkErr)
                // Still don't show error — let polling/realtime handle it
                console.log(`[PAY][${submitId}] STEP 9 — Keeping polling alive despite check failure`)
              }
            } else {
              // Card payment: SDK callback is authoritative — show error immediately
              const errorMsg = parseTranzilaError(tzResult, false)
              console.log(`[PAY][${submitId}] STEP 9 — ❌ Card charge DECLINED: "${errorMsg}"`)
              clearListeners()
              setPaymentError(errorMsg)
              setIsSubmitting(false)
              isSubmittingRef.current = false
              is3DSActiveRef.current = false
            }
          })
          console.log(`[PAY][${submitId}] STEP 8 — ${sdkMethod}() called (callback pending until payment completes)`)
        } catch (err: any) {
          console.error(`[PAY][${submitId}] STEP 8 — ❌ Exception thrown by ${sdkMethod}():`, err?.message || err)
          setPaymentError('Failed to initiate payment. Please refresh the page and try again.')
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
      setPaymentError(t('paymentForm.paymentProcessingFailed'))
    } finally {
      if (!is3DSActiveRef.current) {
        console.log(`[PAY][${submitId}] FINALLY — Not in 3DS/HF active state, resetting submit lock`)
        setIsSubmitting(false)
        isSubmittingRef.current = false
      }
    }
  }

  // ── Formatters ────────────────────────────────────────────────────────────

  const formatPrice = (amount: number) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(amount)

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
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">
                        {t('paymentForm.cardNumber') || 'Card Number'}
                      </label>
                      {/* No padding here — Tranzila's styles.input.padding handles it */}
                      <div
                        id="credit_card_number"
                        className="h-11 rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring transition-shadow w-full relative overflow-hidden"
                        style={{ minHeight: '44px' }}
                      />
                    </div>
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
        {errors.card && (
          <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive">{errors.card}</p>
          </div>
        )}
        
        {errors.installments && (
          <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive">{errors.installments}</p>
          </div>
        )}
        
        {errors.bit && (
          <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive">{errors.bit}</p>
          </div>
        )}

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
                : 'bg-[#7c7a7a45] text-black hover:opacity-90 focus:ring-ring'
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

      {/* 3DS / Bit modal */}
      {show3DS && threeDSUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-lg bg-background rounded-xl shadow-2xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-foreground" />
                <span className="text-sm font-medium text-foreground">
                  {paymentMethod === 'bit'
                    ? t('paymentForm.bitVerification')
                    : t('paymentForm.securePayment')}
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

      {/* Payment Error Popup */}
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
                <p className="text-xs text-muted-foreground">{paymentError ? getErrorHint(paymentError) : t('paymentForm.verifyCardBalance')}</p>
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