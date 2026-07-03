import { NextRequest, NextResponse } from 'next/server'
import { getTaxRules } from '@/lib/tax-rules'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function GET(_request: NextRequest) {
  const rules = await getTaxRules()
  return NextResponse.json(
    { rules: rules.filter((r) => r.enabled) },
    { headers: CORS_HEADERS }
  )
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
