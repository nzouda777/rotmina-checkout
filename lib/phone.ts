// Shared phone utilities: dial-code list for the checkout form selector and
// E.164 normalization used both client-side (customer-form) and server-side
// (Shopify order creation). Keeping one source of truth prevents the frontend
// from accepting a number the backend later mangles.

export interface DialCodeEntry {
  dial: string // digits only, no '+'
  iso: string // ISO 3166-1 alpha-2, used as React key
  label: string
  flag: string
}

// Scoped to the countries offered in the shipping-country selector
// (customer-form.tsx): Israel, United States/Canada, United Kingdom,
// Australia, Switzerland, and "Europe" (expanded here into its member
// countries since a single dial code can't represent "Europe").
export const DIAL_CODES: DialCodeEntry[] = [
  { dial: '972', iso: 'IL', label: 'Israel', flag: '🇮🇱' },
  { dial: '1', iso: 'US', label: 'United States / Canada', flag: '🇺🇸' },
  { dial: '44', iso: 'GB', label: 'United Kingdom', flag: '🇬🇧' },
  { dial: '33', iso: 'FR', label: 'France', flag: '🇫🇷' },
  { dial: '49', iso: 'DE', label: 'Germany', flag: '🇩🇪' },
  { dial: '34', iso: 'ES', label: 'Spain', flag: '🇪🇸' },
  { dial: '39', iso: 'IT', label: 'Italy', flag: '🇮🇹' },
  { dial: '31', iso: 'NL', label: 'Netherlands', flag: '🇳🇱' },
  { dial: '32', iso: 'BE', label: 'Belgium', flag: '🇧🇪' },
  { dial: '41', iso: 'CH', label: 'Switzerland', flag: '🇨🇭' },
  { dial: '43', iso: 'AT', label: 'Austria', flag: '🇦🇹' },
  { dial: '351', iso: 'PT', label: 'Portugal', flag: '🇵🇹' },
  { dial: '30', iso: 'GR', label: 'Greece', flag: '🇬🇷' },
  { dial: '353', iso: 'IE', label: 'Ireland', flag: '🇮🇪' },
  { dial: '45', iso: 'DK', label: 'Denmark', flag: '🇩🇰' },
  { dial: '46', iso: 'SE', label: 'Sweden', flag: '🇸🇪' },
  { dial: '47', iso: 'NO', label: 'Norway', flag: '🇳🇴' },
  { dial: '358', iso: 'FI', label: 'Finland', flag: '🇫🇮' },
  { dial: '48', iso: 'PL', label: 'Poland', flag: '🇵🇱' },
  { dial: '420', iso: 'CZ', label: 'Czech Republic', flag: '🇨🇿' },
  { dial: '36', iso: 'HU', label: 'Hungary', flag: '🇭🇺' },
  { dial: '40', iso: 'RO', label: 'Romania', flag: '🇷🇴' },
  { dial: '352', iso: 'LU', label: 'Luxembourg', flag: '🇱🇺' },
  { dial: '61', iso: 'AU', label: 'Australia', flag: '🇦🇺' },
]

// Longest dial codes first so '+972…' matches 972 before 9, '+351…' matches 351 before 35.
const DIALS_LONGEST_FIRST = [...new Set(DIAL_CODES.map((d) => d.dial))].sort(
  (a, b) => b.length - a.length
)

// Default dial code guessed from the shipping country selected in the form.
// Only a starting point — the user can pick any dial code regardless of address.
export const COUNTRY_DEFAULT_DIAL: Record<string, string> = {
  Israel: '972',
  'United States': '1',
  Canada: '1',
  'United Kingdom': '44',
  France: '33',
  Germany: '49',
  Australia: '61',
  Switzerland: '41',
}

// E.164: max 15 digits total (dial code included), and a sane minimum.
export const E164_MAX_DIGITS = 15
export const E164_MIN_DIGITS = 8

function cleanDigits(raw: string): string {
  return raw.replace(/\D/g, '')
}

/**
 * Normalize any phone input to E.164 ('+9725…').
 * - '+…' or '00…' input is treated as already international.
 * - Otherwise `defaultDial` is used: leading zeros are stripped from the
 *   national part and the dial code is prepended.
 * - If the digits already start with `defaultDial` and are long enough to be
 *   international, they are kept as-is (handles legacy '9725…' values).
 * Returns null when the number cannot be safely normalized — callers must
 * treat null as "omit the phone", never as an error that blocks the order.
 */
export function toE164(raw: string | undefined | null, defaultDial?: string): string | null {
  if (!raw) return null
  let s = String(raw).trim().replace(/[\s\-().]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)

  const isInternational = s.startsWith('+')
  const digits = cleanDigits(s)
  if (!digits) return null

  if (isInternational) {
    if (digits.length < E164_MIN_DIGITS || digits.length > E164_MAX_DIGITS) return null
    return '+' + digits
  }

  if (defaultDial) {
    // Already-international digits without the '+' (legacy sessions store these)
    if (digits.startsWith(defaultDial) && digits.length >= 11 && digits.length <= E164_MAX_DIGITS) {
      return '+' + digits
    }
    const national = digits.replace(/^0+/, '')
    const full = defaultDial + national
    if (national.length < 6 || full.length > E164_MAX_DIGITS) return null
    return '+' + full
  }

  return null
}

/**
 * Split a stored phone into { dial, national } to pre-fill the form selector.
 * Falls back to treating the whole value as national when no dial code matches.
 */
export function splitE164(raw: string | undefined | null): { dial: string | null; national: string } {
  if (!raw) return { dial: null, national: '' }
  let s = String(raw).trim().replace(/[\s\-().]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)
  if (!s.startsWith('+')) return { dial: null, national: raw }

  const digits = cleanDigits(s)
  const dial = DIALS_LONGEST_FIRST.find((d) => digits.startsWith(d))
  if (!dial) return { dial: null, national: digits }
  return { dial, national: digits.slice(dial.length) }
}
