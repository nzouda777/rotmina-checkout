import { NextRequest, NextResponse } from 'next/server'
import { createTranzilaClient } from '@/lib/tranzila'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const amount   = parseFloat(searchParams.get('amount') || '0')
  const currency = (searchParams.get('currency') || 'ILS').toUpperCase()

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }

  const currencyCode = currency === 'USD' ? '2' : '1'
  console.log(`[HANDSHAKE-API] amount=${amount} | currency_param=${currency} | currencyCode=${currencyCode}`)

  const tranzila = createTranzilaClient()
  const thtk = await tranzila.getHandshakeToken(amount, currencyCode)
  console.log(`[HANDSHAKE-API] thtk generated: ${thtk ? thtk.substring(0, 10) + '…' : 'NULL'} | terminal=${process.env.TRANZILA_TERMINAL || 'MISSING'}`)

  if (!thtk) {
    return NextResponse.json({ error: 'Failed to generate handshake token' }, { status: 503 })
  }

  return NextResponse.json({
    thtk,
    terminal: process.env.TRANZILA_TERMINAL || '',
  })
}
