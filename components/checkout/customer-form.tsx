'use client'

import { useState, useEffect, useRef } from 'react'
import type { CustomerInfo } from '@/lib/types'
import { useLanguage } from '@/lib/language-context'
import { DIAL_CODES, COUNTRY_DEFAULT_DIAL, toE164, splitE164, E164_MAX_DIGITS } from '@/lib/phone'
import { fetchAddressSuggestions, type AddressSuggestion } from '@/lib/address-autocomplete'
import { COUNTRY_STATES } from '@/lib/states'

// Postal code formats Shopify/carriers actually check (see
// help.shopify.com .../reviewing-address-formats). Countries not listed here
// (the "Europe" catch-all zone) only get a loose non-empty/length check —
// there's no single format across the EU.
const POSTAL_CODE_PATTERNS: Record<string, RegExp> = {
  // Israel Post moved to 7-digit codes in Feb 2013; the old 5-digit format
  // is no longer precise enough to match Shopify's carrier database ("Postal
  // code doesn't match Israel"), so only the modern 7-digit format is accepted.
  Israel: /^\d{7}$/,
  'United States': /^\d{5}(-\d{4})?$/,
  Canada: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
  'United Kingdom': /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}$/,
  Australia: /^\d{4}$/,
  Switzerland: /^\d{4}$/,
}

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
      province: '',
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

  // ── Returning-customer autofill (admin-toggleable) ──────────────────────────
  const [autofillStatus, setAutofillStatus] = useState<'idle' | 'loading' | 'found'>('idle')
  const lastLookedUpEmail = useRef<string>('')

  const handleEmailBlur = async () => {
    const email = formData.email.trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === lastLookedUpEmail.current) return
    lastLookedUpEmail.current = email

    setAutofillStatus('loading')
    try {
      const res = await fetch(`/api/checkout/customer-lookup?email=${encodeURIComponent(email)}`)
      const data = await res.json()
      if (!data.found || !data.customer) {
        setAutofillStatus('idle')
        return
      }

      const saved = data.customer as CustomerInfo
      const englishCountries = ['United States', 'Canada', 'Europe', 'United Kingdom', 'Australia', 'Switzerland']
      // Only reuse the saved country if it's still valid for the current
      // checkout language — otherwise leave the current default in place.
      const countryApplies =
        (lang === 'he' && saved.country === 'Israel') ||
        (lang === 'en' && englishCountries.includes(saved.country))

      setFormData((prev) => ({
        ...prev,
        firstName: prev.firstName || saved.firstName || prev.firstName,
        lastName: prev.lastName || saved.lastName || prev.lastName,
        address: prev.address || saved.address || prev.address,
        city: prev.city || saved.city || prev.city,
        postalCode: prev.postalCode || saved.postalCode || prev.postalCode,
        ...(countryApplies && !prev.address
          ? { country: saved.country, province: saved.province || prev.province }
          : {}),
      }))

      if (!dialTouched && saved.phone) {
        const parsed = splitE164(saved.phone)
        if (parsed.dial) {
          setDialCode(parsed.dial)
          setFormData((prev) => ({ ...prev, phone: prev.phone || parsed.national }))
        }
      }

      setErrors((prev) => ({
        ...prev, firstName: undefined, lastName: undefined, address: undefined,
        city: undefined, postalCode: undefined, province: undefined,
      }))
      setAutofillStatus('found')
    } catch {
      setAutofillStatus('idle')
    }
  }

  // ── Address autocomplete (Geoapify) on the address field ────────────────────
  const addressInputRef = useRef<HTMLInputElement>(null)
  const addressWrapperRef = useRef<HTMLDivElement>(null)
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const suggestionsRequestRef = useRef(0)

  // Debounced fetch as the customer types in the address field.
  useEffect(() => {
    const query = formData.address
    if (query.trim().length < 3) {
      setSuggestions([])
      return
    }

    const requestId = ++suggestionsRequestRef.current
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      fetchAddressSuggestions(query, formData.country, lang, controller.signal).then((results) => {
        // Ignore stale responses from an earlier keystroke.
        if (requestId !== suggestionsRequestRef.current) return
        setSuggestions(results)
        setActiveSuggestion(-1)
      })
    }, 300)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [formData.address, formData.country, lang])

  // Close the suggestions dropdown on outside click.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (addressWrapperRef.current && !addressWrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const applySuggestion = (suggestion: AddressSuggestion) => {
    const validStateCode = COUNTRY_STATES[formData.country]?.some((s) => s.code === suggestion.stateCode)
    setFormData((prev) => ({
      ...prev,
      address: suggestion.address || prev.address,
      city: suggestion.city || prev.city,
      postalCode: suggestion.postalCode || prev.postalCode,
      province: validStateCode ? suggestion.stateCode : prev.province,
    }))
    setErrors((prev) => ({ ...prev, address: undefined, city: undefined, postalCode: undefined, province: undefined }))
    setSuggestions([])
    setShowSuggestions(false)
  }

  const handleAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveSuggestion((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveSuggestion((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault()
      applySuggestion(suggestions[activeSuggestion])
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

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
      // A state/province from the previous country is never valid for the new one.
      setFormData((prev) => ({ ...prev, province: '' }))
      if (onCountryChange) onCountryChange(value)
    }
    if (name === 'address') {
      setShowSuggestions(true)
    }
    if (name === 'email') {
      setAutofillStatus('idle')
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

    // State/province — required by Shopify's shipping-carrier address check
    // for countries that have them (US, CA, AU, CH). A missing one is what
    // gets an otherwise-correct address flagged "Review address issues".
    if (COUNTRY_STATES[formData.country] && !formData.province) {
      newErrors.province = t('customerForm.provinceRequired')
    }

    // Postal code validation — matches the formats Shopify/carriers actually
    // check (see help.shopify.com .../reviewing-address-formats), so a bad
    // format is caught here instead of showing up as a red banner in Shopify.
    const postal = formData.postalCode.trim()
    const pattern = POSTAL_CODE_PATTERNS[formData.country]
    if (!postal) {
      newErrors.postalCode = t('customerForm.postalCodeRequired')
    } else if (pattern && !pattern.test(postal)) {
      newErrors.postalCode = t('customerForm.postalCodeInvalid')
    } else if (!pattern && postal.length < 3) {
      // "Europe" catch-all zone — no single format, just a sanity length check.
      newErrors.postalCode = t('customerForm.postalCodeInvalid')
    }

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
            onBlur={handleEmailBlur}
            placeholder={t('customerForm.email')}
            className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.email ? 'border-destructive' : 'border-input'
              }`}
          />
          {errors.email && (
            <p className="mt-1 text-sm text-destructive">{errors.email}</p>
          )}
          {autofillStatus === 'loading' && (
            <p className="mt-1 text-xs text-muted-foreground">{t('customerForm.autofillLoading')}</p>
          )}
          {autofillStatus === 'found' && (
            <p className="mt-1 text-xs text-green-600 dark:text-green-400">{t('customerForm.autofillFound')}</p>
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

          <div className="relative" ref={addressWrapperRef}>
            <label htmlFor="address" className="sr-only">{t('customerForm.address')}</label>
            <input
              ref={addressInputRef}
              type="text"
              id="address"
              name="address"
              autoComplete="off"
              value={formData.address}
              onChange={handleChange}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={handleAddressKeyDown}
              placeholder={t('customerForm.address')}
              role="combobox"
              aria-expanded={showSuggestions && suggestions.length > 0}
              aria-autocomplete="list"
              className={`w-full px-4 py-3 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${errors.address ? 'border-destructive' : 'border-input'
                }`}
            />
            {errors.address && (
              <p className="mt-1 text-sm text-destructive">{errors.address}</p>
            )}
            {!errors.address && formData.address.trim() && !/\d/.test(formData.address) && (
              // Non-blocking — Shopify's carrier check flags addresses with no
              // house/building number, but some valid addresses genuinely have
              // none, so this is a hint rather than a hard validation error.
              <p className="mt-1 text-xs text-muted-foreground">{t('customerForm.addressNumberHint')}</p>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <ul
                role="listbox"
                className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
              >
                {suggestions.map((suggestion, index) => (
                  <li
                    key={`${suggestion.label}-${index}`}
                    role="option"
                    aria-selected={index === activeSuggestion}
                    onMouseDown={(e) => {
                      // mousedown (not click) fires before the input's blur handler,
                      // so the selection registers before onBlur/outside-click closes it.
                      e.preventDefault()
                      applySuggestion(suggestion)
                    }}
                    onMouseEnter={() => setActiveSuggestion(index)}
                    className={`px-4 py-2.5 text-sm cursor-pointer border-t border-border first:border-t-0 ${index === activeSuggestion ? 'bg-muted' : ''
                      }`}
                  >
                    {suggestion.label}
                  </li>
                ))}
              </ul>
            )}
          </div>

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

          <div className={`grid gap-3 ${COUNTRY_STATES[formData.country] ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {COUNTRY_STATES[formData.country] && (
              <div className="relative">
                <label htmlFor="province" className="sr-only">{t('customerForm.province')}</label>
                <select
                  id="province"
                  name="province"
                  value={formData.province || ''}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 pe-10 appearance-none rounded-lg border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors cursor-pointer ${errors.province ? 'border-destructive' : 'border-input'
                    }`}
                >
                  <option value="">{t('customerForm.province')}</option>
                  {COUNTRY_STATES[formData.country].map((state) => (
                    <option key={state.code} value={state.code}>{state.name}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 end-4 flex items-center text-muted-foreground">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                {errors.province && (
                  <p className="mt-1 text-sm text-destructive">{errors.province}</p>
                )}
              </div>
            )}
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
