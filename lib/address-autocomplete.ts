// Address autocomplete for the shipping address field — same idea as
// Shopify's own checkout (suggest real, normalized addresses as the customer
// types) but backed by Geoapify's free tier (3,000 requests/day, no credit
// card) instead of Google Places, which requires billing.
//
// Requires NEXT_PUBLIC_GEOAPIFY_API_KEY (see .env.example). When it's
// missing, fetchAddressSuggestions() returns [] and the address field
// silently falls back to a plain text input — no crash, no broken checkout.

const GEOAPIFY_BASE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete'

// Geoapify's `filter=countrycode:xx` takes lowercase ISO 3166-1 alpha-2
// codes, comma-separated for multiple. "Europe" isn't a real country in the
// checkout's shipping-country dropdown (it's a catch-all zone) — restricted
// here to a handful of the countries Rotmina ships to most within Europe.
export const COUNTRY_AUTOCOMPLETE_CODES: Record<string, string> = {
  Israel: 'il',
  'United States': 'us',
  Canada: 'ca',
  'United Kingdom': 'gb',
  Australia: 'au',
  Switzerland: 'ch',
  Europe: 'fr,de,it,es,nl',
}

export interface AddressSuggestion {
  label: string
  address: string
  city: string
  postalCode: string
  /** State/province code, e.g. "NY" — only meaningful for countries with one (see lib/states.ts). */
  stateCode: string
}

interface GeoapifyResult {
  housenumber?: string
  street?: string
  city?: string
  postcode?: string
  state_code?: string
  formatted?: string
  address_line1?: string
  address_line2?: string
}

export async function fetchAddressSuggestions(
  query: string,
  country: string,
  lang: string,
  signal?: AbortSignal
): Promise<AddressSuggestion[]> {
  const apiKey = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY
  if (!apiKey || query.trim().length < 3) return []

  const params = new URLSearchParams({
    text: query,
    apiKey,
    format: 'json',
    lang: lang === 'he' ? 'he' : 'en',
    limit: '5',
  })
  const countryCode = COUNTRY_AUTOCOMPLETE_CODES[country]
  if (countryCode) params.set('filter', `countrycode:${countryCode}`)

  try {
    const res = await fetch(`${GEOAPIFY_BASE_URL}?${params.toString()}`, { signal })
    if (!res.ok) return []
    const data = await res.json()
    const results: GeoapifyResult[] = data?.results || []

    return results
      .map((r) => {
        const address = [r.housenumber, r.street].filter(Boolean).join(' ') || r.address_line1 || ''
        const city = r.city || ''
        const postalCode = r.postcode || ''
        // Geoapify returns state_code lowercase (e.g. "ny") — our state lists use uppercase.
        const stateCode = (r.state_code || '').toUpperCase()
        if (!address && !city) return null
        return { label: r.formatted || [address, city].filter(Boolean).join(', '), address, city, postalCode, stateCode }
      })
      .filter((s): s is AddressSuggestion => s !== null)
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn('[ADDRESS-AUTOCOMPLETE] Request failed:', err)
    }
    return []
  }
}
