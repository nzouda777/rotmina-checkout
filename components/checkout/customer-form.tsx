'use client'

import { useState, useEffect } from 'react'
import type { CustomerInfo } from '@/lib/types'
import { useLanguage } from '@/lib/language-context'
import { DIAL_CODES, COUNTRY_DEFAULT_DIAL, toE164, splitE164, E164_MAX_DIGITS } from '@/lib/phone'

interface CustomerFormProps {
  initialData: CustomerInfo
  onSubmit: (data: CustomerInfo) => void
  onCountryChange?: (country: string) => void
}

// Generic validation only: the dial code comes from the selector, so any
// nationality of number is accepted regardless of the shipping country.
// A '+' or '00' prefix in the input overrides the selector entirely.
function validatePhoneInput(national: string, dialCode: string): 'tooShort' | 'tooLong' | null {
  const clean = national.trim().replace(/[\s\-().]/g, '')
  const isInternational = clean.startsWith('+') || clean.startsWith('00')
  const digits = clean.replace(/\D/g, '')

  if (isInternational) {
    if (digits.length < 8) return 'tooShort'
    if (digits.length > E164_MAX_DIGITS) return 'tooLong'
    return null
  }

  const nationalDigits = digits.replace(/^0+/, '')
  if (nationalDigits.length < 6) return 'tooShort'
  if (dialCode.length + nationalDigits.length > E164_MAX_DIGITS) return 'tooLong'
  return null
}

export function CustomerForm({ initialData, onSubmit, onCountryChange }: CustomerFormProps) {
  const [formData, setFormData] = useState<CustomerInfo>(() => {
    // If a previous session stored an E.164 phone, show only the national part
    // (the dial code is restored into the selector below).
    const parsed = splitE164(initialData.phone)
    return {
      nationalId: '',
      ...initialData,
      phone: parsed.dial ? parsed.national : initialData.phone,
    }
  })
  const { t, lang } = useLanguage()
  // Phone dial code is independent from the shipping country: an Israeli
  // customer shipping to Europe keeps a +972 number.
  const [dialCode, setDialCode] = useState<string>(() => {
    const parsed = splitE164(initialData.phone)
    if (parsed.dial) return parsed.dial
    return COUNTRY_DEFAULT_DIAL[initialData.country] || (lang === 'he' ? '972' : '1')
  })
  const [dialTouched, setDialTouched] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerInfo, string>>>({})

  useEffect(() => {
    if (lang === 'he') {
      if (formData.country !== 'Israel') {
        setFormData((prev) => ({ ...prev, country: 'Israel' }))
        if (!dialTouched) setDialCode('972')
      }
    } else {
      const englishCountries = ['United States', 'Canada', 'Europe', 'United Kingdom', 'Australia', 'Switzerland']
      if (!englishCountries.includes(formData.country)) {
        setFormData((prev) => ({ ...prev, country: 'United States' }))
        if (!dialTouched) setDialCode('1')
      }
    }
  }, [lang])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name as keyof CustomerInfo]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }))
    }
    if (name === 'country') {
      // Suggest the dial code matching the new shipping country, but never
      // override a dial code the user picked explicitly.
      if (!dialTouched && COUNTRY_DEFAULT_DIAL[value]) {
        setDialCode(COUNTRY_DEFAULT_DIAL[value])
      }
      if (onCountryChange) onCountryChange(value)
    }
  }

  const handleDialChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDialCode(e.target.value)
    setDialTouched(true)
    if (errors.phone) setErrors((prev) => ({ ...prev, phone: undefined }))
  }

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof CustomerInfo, string>> = {}

    // Email validation
    if (!formData.email) {
      newErrors.email = t('customerForm.emailRequired')
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = t('customerForm.invalidEmail')
    }

    // Required fields for Shopify
    if (!formData.firstName) newErrors.firstName = t('customerForm.firstNameRequired')
    if (!formData.lastName) newErrors.lastName = t('customerForm.lastNameRequired')
    if (!formData.address) newErrors.address = t('customerForm.addressRequired')
    if (!formData.city) newErrors.city = t('customerForm.cityRequired')

    // Country validation (required for Shopify)
    if (!formData.country) {
      newErrors.country = 'Country is required for order processing'
    }

    // Postal code validation (required for Shopify)
    //  if (formData.country === 'Israel' && !/^\d{5,7}$/.test(formData.postalCode.replace(/\D/g, ''))) {
    //   newErrors.postalCode = 'Invalid Israeli postal code (5-7 digits)'
    // } else if (formData.country === 'United States' && !/^\d{5}(-\d{4})?$/.test(formData.postalCode)) {
    //   newErrors.postalCode = 'Invalid US postal code format (12345 or 12345-6789)'
    // } else if (formData.country === 'United Kingdom' && !/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(formData.postalCode.toUpperCase())) {
    //   newErrors.postalCode = 'Invalid UK postal code format (e.g., SW1A 1AA)'
    // }

    // Phone validation (required for Shopify) — length checks only, any
    // country's number is accepted via the dial code selector.
    if (!formData.phone) {
      newErrors.phone = t('customerForm.phoneRequired')
    } else {
      const phoneError = validatePhoneInput(formData.phone, dialCode)
      if (phoneError === 'tooShort') newErrors.phone = t('customerForm.phoneTooShort')
      if (phoneError === 'tooLong') newErrors.phone = t('customerForm.phoneTooLong')
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (validate()) {
      // Normalize to E.164 (+9725…) so Shopify and Tranzila always receive a
      // valid international number, whatever the shipping country.
      const e164 = toE164(formData.phone, dialCode)
      onSubmit({ ...formData, phone: e164 || formData.phone })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Contact Information */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">{t('customerForm.contact')}</h2>
        <div>
          <label htmlFor="email" className="sr-only">{t('customerForm.email')}</label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder={t('customerForm.email')}
            className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.email ? 'border-destructive' : 'border-input'
              }`}
          />
          {errors.email && (
            <p className="mt-1 text-sm text-destructive">{errors.email}</p>
          )}
        </div>
      </div>

      {/* Shipping Address */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">{t('customerForm.shippingAddress')}</h2>
        <div className="space-y-3">
          <div className="relative">
            

            {lang === 'he' ? (
              <>
                  <label htmlFor="country" className="sr-only">ישראל</label>
              <input
                type="text"
                id="country"
                disabled
                name="country"
                value="ישראל "
                onChange={handleChange}
                placeholder={t('customerForm.countryRegion')}
                className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.country ? 'border-destructive' : 'border-input'
                  }`}
              />
              </>
            ) : (
              <>
              <label htmlFor="country" className="sr-only">{t('customerForm.countryRegion')}</label>
                <select
                  id="country"
                  name="country"
                  value={formData.country}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 pe-12 appearance-none rounded-lg border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors cursor-pointer ${errors.country ? 'border-destructive' : 'border-input'
                    }`}
                >
                  <>
                    <option value="United States">{t('customerForm.unitedStates')}</option>
                    <option value="Canada">{t('customerForm.canada')}</option>
                    <option value="Europe">{t('customerForm.europe')}</option>
                    <option value="United Kingdom">{t('customerForm.unitedKingdom')}</option>
                    <option value="Australia">{t('customerForm.australia')}</option>
                    <option value="Switzerland">{t('customerForm.switzerland')}</option>
                  </>
                </select>
                <div className="pointer-events-none absolute inset-y-0 end-4 flex items-center text-muted-foreground">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </>
            )}

            {errors.country && (
              <p className="mt-1 text-sm text-destructive">{errors.country}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="sr-only">{t('customerForm.firstName')}</label>
              <input
                type="text"
                id="firstName"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                placeholder={t('customerForm.firstName')}
                className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.firstName ? 'border-destructive' : 'border-input'
                  }`}
              />
              {errors.firstName && (
                <p className="mt-1 text-sm text-destructive">{errors.firstName}</p>
              )}
            </div>
            <div>
              <label htmlFor="lastName" className="sr-only">{t('customerForm.lastName')}</label>
              <input
                type="text"
                id="lastName"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                placeholder={t('customerForm.lastName')}
                className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.lastName ? 'border-destructive' : 'border-input'
                  }`}
              />
              {errors.lastName && (
                <p className="mt-1 text-sm text-destructive">{errors.lastName}</p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="address" className="sr-only">{t('customerForm.address')}</label>
            <input
              type="text"
              id="address"
              name="address"
              value={formData.address}
              onChange={handleChange}
              placeholder={t('customerForm.address')}
              className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.address ? 'border-destructive' : 'border-input'
                }`}
            />
            {errors.address && (
              <p className="mt-1 text-sm text-destructive">{errors.address}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="city" className="sr-only">{t('customerForm.city')}</label>
              <input
                type="text"
                id="city"
                name="city"
                value={formData.city}
                onChange={handleChange}
                placeholder={t('customerForm.city')}
                className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.city ? 'border-destructive' : 'border-input'
                  }`}
              />
              {errors.city && (
                <p className="mt-1 text-sm text-destructive">{errors.city}</p>
              )}
            </div>
            <div>
              <label htmlFor="postalCode" className="sr-only">{t('customerForm.postalCode')}</label>
              <input
                type="text"
                id="postalCode"
                name="postalCode"
                value={formData.postalCode}
                onChange={handleChange}
                placeholder={t('customerForm.postalCode')}
                className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.postalCode ? 'border-destructive' : 'border-input'
                  }`}
              />
              {errors.postalCode && (
                <p className="mt-1 text-sm text-destructive">{errors.postalCode}</p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="phone" className="sr-only">{t('customerForm.phone')}</label>
            <div className="flex gap-2" dir="ltr">
              <div className="relative shrink-0">
                <label htmlFor="phoneDialCode" className="sr-only">{t('customerForm.phone')} +</label>
                <select
                  id="phoneDialCode"
                  name="phoneDialCode"
                  value={dialCode}
                  onChange={handleDialChange}
                  className={`h-full appearance-none rounded-lg border bg-background text-foreground ps-3 pe-8 py-3 focus:outline-none focus:ring-2 focus:ring-ring transition-colors cursor-pointer ${errors.phone ? 'border-destructive' : 'border-input'
                    }`}
                >
                  {DIAL_CODES.map((entry) => (
                    <option key={entry.iso} value={entry.dial}>
                      {entry.flag} +{entry.dial}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-muted-foreground">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="50 123 4567"
                className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.phone ? 'border-destructive' : 'border-input'
                  }`}
              />
            </div>
            {errors.phone && (
              <p className="mt-1 text-sm text-destructive">{errors.phone}</p>
            )}
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        className="w-full py-4 px-6 rounded-lg bg-[#7c7a7a45] text-gray-700 font-semibold text-base hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {t('customerForm.continueToPayment')}
      </button>
    </form>
  )
}
