'use client'

import { useState, useEffect } from 'react'
import type { CustomerInfo } from '@/lib/types'
import { useLanguage } from '@/lib/language-context'

interface CustomerFormProps {
  initialData: CustomerInfo
  onSubmit: (data: CustomerInfo) => void
  onCountryChange?: (country: string) => void
}

interface PhoneRule {
  regex: RegExp
  placeholder: string
  example: string
  minDigits: number
  maxDigits: number
}

const PHONE_RULES: Record<string, PhoneRule> = {
  'Israel': {
    // 05X-XXXXXXX (mobile) or 0X-XXXXXXX (landline), optionally +972 prefix
    regex: /^(\+?972|0)(5[0-9]|[2-4679])\d{7}$/,
    placeholder: '050-0000000',
    example: '050-0000000 or +972-50-0000000',
    minDigits: 9,
    maxDigits: 12,
  },
  'United States': {
    // +1XXXXXXXXXX or 10-digit local
    regex: /^(\+?1)?[2-9]\d{2}[2-9]\d{6}$/,
    placeholder: '(555) 000-0000',
    example: '(555) 000-0000 or +1 555 000-0000',
    minDigits: 10,
    maxDigits: 11,
  },
  'United Kingdom': {
    // 07XXXXXXXXX (mobile) or +44XXXXXXXXXX
    regex: /^(\+?44|0)[1-9]\d{9,10}$/,
    placeholder: '07700 900000',
    example: '07700 900000 or +44 7700 900000',
    minDigits: 10,
    maxDigits: 13,
  },
  'France': {
    // 0X XX XX XX XX or +33XXXXXXXXX
    regex: /^(\+?33|0)[1-9]\d{8}$/,
    placeholder: '06 00 00 00 00',
    example: '06 00 00 00 00 or +33 6 00 00 00 00',
    minDigits: 9,
    maxDigits: 12,
  },
  'Germany': {
    // 0XXX XXXXXXXX or +49XXX XXXXXXXX, variable length
    regex: /^(\+?49|0)[1-9]\d{8,11}$/,
    placeholder: '0151 00000000',
    example: '0151 00000000 or +49 151 00000000',
    minDigits: 9,
    maxDigits: 13,
  },
}

function validatePhone(phone: string, country: string): string | null {
  const cleanPhone = phone.replace(/[\s\-().]/g, '')
  const rule = PHONE_RULES[country]

  if (!rule) {
    // Generic validation for unknown countries
    const digits = cleanPhone.replace(/\D/g, '')
    if (digits.length < 7) return 'Phone number is too short'
    if (digits.length > 15) return 'Phone number is too long'
    return null
  }

  const digits = cleanPhone.replace(/\D/g, '')
  if (digits.length < rule.minDigits) return null // let regex give the specific error
  if (digits.length > rule.maxDigits) return `Phone number is too long (max ${rule.maxDigits} digits for ${country})`

  if (!rule.regex.test(cleanPhone)) {
    return `Invalid phone number for ${country}. Expected format: ${rule.example}`
  }

  return null
}


export function CustomerForm({ initialData, onSubmit, onCountryChange }: CustomerFormProps) {
  const [formData, setFormData] = useState<CustomerInfo>(() => ({
    nationalId: '',
    ...initialData,
  }))
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerInfo, string>>>({})
  const { t, lang } = useLanguage()

  useEffect(() => {
    if (lang === 'he') {
      if (formData.country !== 'Israel') {
        setFormData((prev) => ({ ...prev, country: 'Israel' }))
      }
    } else {
      const englishCountries = ['United States', 'Canada', 'Europe', 'United Kingdom', 'Australia', 'Switzerland']
      if (!englishCountries.includes(formData.country)) {
        setFormData((prev) => ({ ...prev, country: 'United States' }))
      }
    }
  }, [lang])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name as keyof CustomerInfo]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }))
    }
    if (name === 'country' && onCountryChange) {
      onCountryChange(value)
    }
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

    // Phone validation (required for Shopify)
    if (!formData.phone) {
      newErrors.phone = t('customerForm.phoneRequired')
    } else {
      const phoneError = validatePhone(formData.phone, formData.country)
      if (phoneError) newErrors.phone = phoneError
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (validate()) {
      onSubmit(formData)
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
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder={PHONE_RULES[formData.country]?.placeholder ?? t('customerForm.phone')}
              className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.phone ? 'border-destructive' : 'border-input'
                }`}
            />
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
