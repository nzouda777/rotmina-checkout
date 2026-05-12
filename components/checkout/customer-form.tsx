'use client'

import { useState } from 'react'
import type { CustomerInfo } from '@/lib/types'
import { useLanguage } from '@/lib/language-context'

interface CustomerFormProps {
  initialData: CustomerInfo
  onSubmit: (data: CustomerInfo) => void
}

export function CustomerForm({ initialData, onSubmit }: CustomerFormProps) {
  const [formData, setFormData] = useState<CustomerInfo>(initialData)
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerInfo, string>>>({})
  const { t } = useLanguage()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name as keyof CustomerInfo]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }))
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
    if (!formData.postalCode) {
      newErrors.postalCode = 'Postal code is required for order processing'
    } else if (formData.country === 'Israel' && !/^\d{5,7}$/.test(formData.postalCode.replace(/\D/g, ''))) {
      newErrors.postalCode = 'Invalid Israeli postal code (5-7 digits)'
    } else if (formData.country === 'United States' && !/^\d{5}(-\d{4})?$/.test(formData.postalCode)) {
      newErrors.postalCode = 'Invalid US postal code format (12345 or 12345-6789)'
    } else if (formData.country === 'United Kingdom' && !/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(formData.postalCode.toUpperCase())) {
      newErrors.postalCode = 'Invalid UK postal code format (e.g., SW1A 1AA)'
    }
    
    // Phone validation (required for Shopify)
    if (!formData.phone) {
      newErrors.phone = t('customerForm.phoneRequired')
    } else {
      const cleanPhone = formData.phone.replace(/\D/g, '')
      if (cleanPhone.length < 9) {
        newErrors.phone = 'Phone number must be at least 9 digits'
      } else if (cleanPhone.length > 15) {
        newErrors.phone = 'Phone number is too long'
      }
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
            className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
              errors.email ? 'border-destructive' : 'border-input'
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
            <label htmlFor="country" className="sr-only">{t('customerForm.countryRegion')}</label>
            <select
              id="country"
              name="country"
              value={formData.country}
              onChange={handleChange}
              className={`w-full px-4 py-3 pe-12 appearance-none rounded-lg border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors cursor-pointer ${
                errors.country ? 'border-destructive' : 'border-input'
              }`}
            >
              {/* <option value="">{t('customerForm.selectCountry')}</option> */}
              <option value="Israel">{t('customerForm.israel')}</option>
              <option value="United States">{t('customerForm.unitedStates')}</option>
              <option value="United Kingdom">{t('customerForm.unitedKingdom')}</option>
              <option value="France">{t('customerForm.france')}</option>
              <option value="Germany">{t('customerForm.germany')}</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 end-4 flex items-center text-muted-foreground">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
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
                className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                  errors.firstName ? 'border-destructive' : 'border-input'
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
                className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                  errors.lastName ? 'border-destructive' : 'border-input'
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
              className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                errors.address ? 'border-destructive' : 'border-input'
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
                className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                  errors.city ? 'border-destructive' : 'border-input'
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
                className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                  errors.postalCode ? 'border-destructive' : 'border-input'
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
              placeholder={t('customerForm.phone')}
              className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                errors.phone ? 'border-destructive' : 'border-input'
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
        className="w-full py-4 px-6 rounded-lg bg-[#7c7a7a45] text-black font-semibold text-base hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {t('customerForm.continueToPayment')}
      </button>
    </form>
  )
}
