import { NextRequest, NextResponse } from 'next/server'
import { findOrdersWithMissingDiscount, fixOrderMissingDiscount } from '@/lib/shopify-order-balance'

function checkAuth(req: NextRequest) {
  const key = req.headers.get('x-admin-key')
  return !!process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY
}

/** GET — paid orders that show a balance due in Shopify because their discount is missing. */
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ issues: await findOrdersWithMissingDiscount() })
  } catch (err: any) {
    console.error('[ADMIN-ORDER-BALANCE] Scan failed:', err?.message || err)
    return NextResponse.json({ error: err?.message || 'Scan failed' }, { status: 502 })
  }
}

/** POST { sessionId } — add the missing discount to that order in Shopify. */
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { body = {} }
  if (typeof body?.sessionId !== 'string' || !body.sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
  }
  try {
    const result = await fixOrderMissingDiscount(body.sessionId)
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    console.error(`[ADMIN-ORDER-BALANCE] Fix failed for ${body.sessionId}:`, err?.message || err)
    return NextResponse.json({ success: false, error: err?.message || 'Fix failed' }, { status: 422 })
  }
}
