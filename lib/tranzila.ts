import crypto from 'crypto'
import type { TranzilaConfig, TranzilaChargeParams, TranzilaResponse } from './types'

const DEFAULT_TRANZILA_API_URL = 'https://api.tranzila.com/v1/transaction/credit_card/create'

export class TranzilaClient {
  private config: TranzilaConfig

  constructor(config: TranzilaConfig) {
    this.config = config
  }

  private generateAccessToken(appKey: string, secret: string, time: number, nonce: string): string {
    const key = `${secret}${time}${nonce}`
    return crypto.createHmac('sha256', key).update(appKey).digest('hex')
  }

  private makeNonce(length: number): string {
    let result = ''
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const charactersLength = characters.length
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength))
    }
    return result
  }

  async charge(params: any): Promise<TranzilaResponse> {
    const apiUrl = process.env.TRANZILA_API_URL || DEFAULT_TRANZILA_API_URL
    const appKey = process.env.TRANZILA_APP_KEY || ''
    const secret = process.env.TRANZILA_SECRET || ''
    const time = Math.round(Date.now() / 1000)
    const nonce = this.makeNonce(80)
    const accessToken = this.generateAccessToken(appKey, secret, time, nonce)

    const logParams = { ...params }
    if (logParams.card_number) logParams.card_number = 'XXXX-XXXX-XXXX-' + String(logParams.card_number).slice(-4)
    if (logParams.cvv) logParams.cvv = '***'

    console.log('[DEBUG] TRANZILA REQUEST:', {
      url: apiUrl,
      headers: {
        'X-tranzila-api-app-key': appKey,
        'X-tranzila-api-request-time': time,
        'X-tranzila-api-nonce': nonce,
        'X-tranzila-api-access-token': accessToken.substring(0, 10) + '...',
      },
      body: logParams,
    })

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-tranzila-api-app-key': appKey,
          'X-tranzila-api-request-time': String(time),
          'X-tranzila-api-nonce': nonce,
          'X-tranzila-api-access-token': accessToken,
        },
        body: JSON.stringify({
          terminal_name: this.config.terminalName,
          ...params,
          cvv: String(params.cvv),
        }),
      })

      const text = await response.text()

      if (!response.ok) {
        console.error('[DEBUG] TRANZILA ERROR RESPONSE:', {
          status: response.status,
          statusText: response.statusText,
          body: text,
        })
        throw new Error(`Tranzila request failed: ${response.statusText} (${response.status})`)
      }

      console.log('[DEBUG] TRANZILA SUCCESS RESPONSE:', text)
      return JSON.parse(text) as TranzilaResponse
    } catch (err) {
      console.error('[DEBUG] TRANZILA EXCEPTION:', err)
      throw err
    }
  }

  static isSuccess(response: any): boolean {
    if (!response) return false

    // Erreur de validation explicite → jamais un succès
    if (response.error_code) return false

    // Code Response legacy '000'
    if (response.Response === '000') return true

    // Champ status (insensible à la casse)
    if (typeof response.status === 'string') {
      const s = response.status.toLowerCase()
      if (s === 'success' || s === 'approved' || s === 'ok') return true
      if (s === 'failed' || s === 'error' || s === 'declined') return false
    }

    // Champ success explicite
    if (response.success === true) return true

    // Présence d'un code de confirmation = transaction approuvée
    if (response.ConfirmationCode || response.transaction_id || response.index) return true

    return false
  }

  static getErrorMessage(response: any): string {
    if (!response) return 'Unknown error'

    // Erreur de validation schema (error_code présent)
    if (response.error_code) {
      let msg = response.message || 'Validation error'
      if (response.mismatch_info && Array.isArray(response.mismatch_info)) {
        const details = response.mismatch_info
          .map((m: any) => `${(m.data_path || []).join('.')}: ${m.keyword || 'invalid type'}`)
          .join(', ')
        if (details) msg += ` (${details})`
      }
      return msg
    }

    // Tableau errors[]
    if (Array.isArray(response.errors) && response.errors.length > 0) {
      return response.errors.map((e: any) => e.message || e.code).join(', ')
    }

    // Champ error string
    if (response.error && typeof response.error === 'string') {
      return response.error
    }

    // Codes Response legacy
    const errorMessages: Record<string, string> = {
      '001': 'Card blocked',
      '002': 'Card stolen',
      '003': 'Contact credit company',
      '004': 'Refusal',
      '005': 'Forged card',
      '006': 'CVV or ID error',
      '007': 'Contact credit company',
      '009': 'Transaction not permitted',
      '010': 'Transaction not approved',
      '011': 'Invalid amount',
      '012': 'Invalid card number',
      '014': 'Invalid terminal',
      '015': 'Terminal not found',
      '017': 'Card expired',
      '033': 'Invalid currency',
    }

    const code = response.Response
    if (code && code !== '000') {
      return errorMessages[code] || `Transaction failed (Code: ${code})`
    }

    return 'Transaction failed'
  }
}

export function createTranzilaClient(): TranzilaClient {
  return new TranzilaClient({
    terminalName: process.env.TRANZILA_TERMINAL || '',
    terminalPassword: process.env.TRANZILA_TERMINAL_PASSWORD,
    testMode: process.env.TRANZILA_TEST_MODE === 'true',
  })
}