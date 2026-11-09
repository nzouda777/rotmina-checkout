import { NextRequest, NextResponse } from 'next/server'
import { reconcileMorningReceipts } from '@/lib/morning-receipts'

function checkAuth(req: NextRequest) {
  const key = req.headers.get('x-admin-key')
  return !!process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY
}

/**
 * POST /api/admin/morning-receipts/reconcile  { since?: 'YYYY-MM-DD', dryRun?: boolean }
 *
 * Checks every paid order with no recorded invoice (paid since `since`)
 * against the documents in Morning. Found → marked sent; not found → marked
 * failed, so it shows in the "Failed" tab ready to resend. Read-only on Morning.
 */
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { body = {} }
  const since = typeof body?.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.since) ? body.since : undefined

  try {
    const result = await reconcileMorningReceipts({ dryRun: body?.dryRun === true, since })
    console.log(`[ADMIN-MORNING] Reconcile since ${since || 'beginning'}: checked=${result.checked} found=${result.found} missing=${result.missing.length}`)
    return NextResponse.json(result)
  } catch (err: any) {
    const message = err?.message || String(err)
    console.error('[ADMIN-MORNING] Reconcile failed:', message)
    if (/011_add_morning_receipt_tracking/.test(message)) {
      return NextResponse.json({ migrationRequired: true, error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
