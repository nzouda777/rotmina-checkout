// Links back to the public storefront must keep the checkout language:
// English visitors go to the /en/… version of the site, Hebrew visitors to
// the root. Example: storeUrl('en', '/collections/shop')
// → https://rotmina.co/en/collections/shop

const STORE_BASE = (process.env.NEXT_PUBLIC_STORE_URL || 'https://rotmina.co').replace(/\/$/, '')

export function storeUrl(lang: string, path: string = ''): string {
  const prefix = lang === 'he' ? '' : '/en'
  return `${STORE_BASE}${prefix}${path}`
}
