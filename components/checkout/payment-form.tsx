'use client'

import { useState } from 'react'
import { ArrowLeft, CreditCard, Lock, Shield } from 'lucide-react'
import type { CustomerInfo } from '@/lib/types'

interface PaymentFormProps {
  sessionId: string
  customerInfo: CustomerInfo
  total: number
  currency: string
  onBack: () => void
  onSuccess: (confirmationCode: string) => void
  onError: (error: string) => void
  onProcessing: () => void
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
}: PaymentFormProps) {
  const [cardNumber, setCardNumber] = useState('')
  const [cardholderName, setCardholderName] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [cvv, setCvv] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [show3DS, setShow3DS] = useState(false)
  const [threeDSUrl, setThreeDSUrl] = useState('')

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
    const cardDigits = cardNumber.replace(/\s/g, '')

    if (!cardDigits || cardDigits.length < 13) {
      newErrors.cardNumber = 'Invalid card number'
    }

    if (!cardholderName.trim()) {
      newErrors.cardholderName = 'Cardholder name is required'
    }

    if (!expiryDate || expiryDate.length < 5) {
      newErrors.expiryDate = 'Invalid expiry date'
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
        newErrors.expiryDate = 'Card has expired'
      }
    }

    if (!cvv || cvv.length < 3) {
      newErrors.cvv = 'Invalid CVV'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setIsSubmitting(true)
    onProcessing()

    try {
      const response = await fetch('/api/checkout/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          customerInfo,
          cardNumber: cardNumber.replace(/\s/g, ''),
          expiryDate,
          cvv,
          cardholderName,
        }),
      })

      const result = await response.json()
      
      if (result.requires3DS && result.redirectUrl) {
        setThreeDSUrl(result.redirectUrl)
        setShow3DS(true)
        return
      }

    if (result.success) {
      // Cas terminal sans 3DS — redirection directe Shopify
      window.location.href = `https://${process.env.SHOPIFY_STORE_DOMAIN}/`
      return
    }

    // Erreur
    onError(result.error || 'Paiement refusé')
      if (result.success) {
        onSuccess(result.confirmationCode)
      } else {
        onError(result.error || 'Payment failed')
      }
    } catch {
      onError('Payment processing failed. Please try again.')
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

  return (
    <div className="space-y-6">
      {/* Contact Summary */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex justify-between items-start">
          <div className="space-y-2 text-sm">
            <div className="flex gap-8">
              <span className="text-muted-foreground w-20">Contact</span>
              <span className="text-foreground">{customerInfo.email}</span>
            </div>
            <div className="flex gap-8">
              <span className="text-muted-foreground w-20">Ship to</span>
              <span className="text-foreground">
                {customerInfo.address}, {customerInfo.city}, {customerInfo.country}
              </span>
            </div>
          </div>
          <button
            onClick={onBack}
            className="text-sm text-foreground underline hover:no-underline"
          >
            Change
          </button>
        </div>
      </div>

      {/* Payment Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4">Payment</h2>
          <p className="text-sm text-muted-foreground mb-4">
            All transactions are secure and encrypted.
          </p>

          <div className="rounded-lg border border-border overflow-hidden">
            {/* Card Header */}
            <div className="bg-muted/50 px-4 py-3 flex items-center justify-between border-b border-border">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-foreground" />
                <span className="text-sm font-medium text-foreground">Credit card</span>
              </div>
              <div className="flex items-center gap-2">
                <CardBrand type="visa" />
                <CardBrand type="mastercard" />
                <CardBrand type="amex" />
              </div>
            </div>

            {/* Card Fields */}
            <div className="p-4 space-y-3 bg-background">
              <div>
                <label htmlFor="cardNumber" className="sr-only">Card number</label>
                <div className="relative">
                  <input
                    type="text"
                    id="cardNumber"
                    value={cardNumber}
                    onChange={handleCardNumberChange}
                    placeholder="Card number"
                    maxLength={19}
                    // autoComplete="cc-number"
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
                <label htmlFor="cardholderName" className="sr-only">Cardholder name</label>
                <input
                  type="text"
                  id="cardholderName"
                  value={cardholderName}
                  onChange={(e) => {
                    setCardholderName(e.target.value)
                    if (errors.cardholderName) setErrors((prev) => ({ ...prev, cardholderName: '' }))
                  }}
                  placeholder="Cardholder name"
                  // autoComplete="cc-name"
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
                  <label htmlFor="expiryDate" className="sr-only">Expiration date (MM/YY)</label>
                  <input
                    type="text"
                    id="expiryDate"
                    value={expiryDate}
                    onChange={handleExpiryChange}
                    placeholder="MM / YY"
                    maxLength={5}
                    // autoComplete="cc-exp"
                    className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                      errors.expiryDate ? 'border-destructive' : 'border-input'
                    }`}
                  />
                  {errors.expiryDate && (
                    <p className="mt-1 text-sm text-destructive">{errors.expiryDate}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="cvv" className="sr-only">Security code</label>
                  <div className="relative">
                    <input
                      type="text"
                      id="cvv"
                      value={cvv}
                      onChange={handleCvvChange}
                      placeholder="CVV"
                      maxLength={4}
                      // autoComplete="cc-csc"
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
            </div>
          </div>
        </div>

        {/* Security Badge */}
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Shield className="h-4 w-4" />
          <span>Your payment information is secure and encrypted</span>
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row gap-4 items-center">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-foreground hover:opacity-70 transition-opacity"
          >
            <ArrowLeft className="h-4 w-4" />
            Return to information
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:flex-1 py-4 px-6 rounded-lg bg-foreground text-background font-semibold text-base hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Processing...' : `Pay ${formatPrice(total)}`}
          </button>
        </div>
      </form>
    </div>
  )
}

function CardBrand({ type }: { type: string }) {
  const brands: Record<string, { bg: string; text: string }> = {
    visa: { bg: 'bg-blue-600', text: 'VISA' },
    mastercard: { bg: 'bg-orange-500', text: 'MC' },
    amex: { bg: 'bg-blue-400', text: 'AMEX' },
    discover: { bg: 'bg-orange-400', text: 'DISC' },
    generic: { bg: 'bg-muted', text: '' },
  }

  const brand = brands[type] || brands.generic

  if (type === 'generic') {
    return <CreditCard className="h-6 w-6 text-muted-foreground" />
  }

  return (
    <div className={`h-6 px-2 rounded ${brand.bg} flex items-center justify-center`}>
      <span className="text-[10px] font-bold text-white">{brand.text}</span>
    </div>
  )
}
