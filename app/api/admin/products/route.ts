import { NextRequest, NextResponse } from 'next/server'

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key')
  return !!process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ACCESS_TOKEN
  const version = process.env.SHOPIFY_API_VERSION || '2026-04'

  if (!domain || !token) {
    return NextResponse.json({ error: 'Shopify not configured' }, { status: 500 })
  }

  const url = `https://${domain}/admin/api/${version}/products.json?limit=250&fields=id,title,variants`

  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 300 }, // cache 5 min
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch Shopify products' }, { status: 502 })
  }

  const { products } = await res.json()

  const simplified = (products as any[]).map((p) => ({
    id: p.id as number,
    title: p.title as string,
    variants: (p.variants as any[]).map((v) => ({
      id: v.id as number,
      title: v.title as string,
    })),
  }))

  return NextResponse.json(simplified)
}
