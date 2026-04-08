import crypto from 'crypto'
import type { TranzilaConfig, TranzilaChargeParams, TranzilaResponse } from './types'

const DEFAULT_TRANZILA_API_URL = 'https://api.tranzila.com/v1/transaction/credit_card/create'

export class TranzilaClient {
  private config: TranzilaConfig

  constructor(config: TranzilaConfig) {
    this.config = config
  }

  private generateAccessToken(appKey: string, secret: string, time: number, nonce: string): string {
    const message = `${appKey}${time}${nonce}`
    return crypto.createHmac('sha256', secret).update(message).digest('hex')
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

    // Log request (obfuscating sensitive data)
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
          ...params
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

  static getErrorMessage(response: any): string {
    // Check for REST API error format
    if (response && response.errors && Array.isArray(response.errors) && response.errors.length > 0) {
      return response.errors.map((e: any) => e.message || e.code).join(', ')
    }

    if (response && response.error && typeof response.error === 'string') {
      return response.error
    }

    const responseCode = response?.Response || 'error'
    
    const errorMessages: Record<string, string> = {
      '000': 'Transaction approved',
      '001': 'Card blocked',
      '002': 'Card stolen',
      '003': 'Contact credit company',
      '004': 'Refusal',
      '005': 'Forged card',
      '006': 'CVV or ID error',
      '007': 'Contact credit company',
      '008': 'Error building access code',
      '009': 'Transaction not permitted',
      '010': 'Transaction not approved',
      '011': 'Invalid amount',
      '012': 'Invalid card number',
      '014': 'Invalid terminal',
      '015': 'Terminal not found',
      '017': 'Card expired',
      '033': 'Invalid currency',
      '036': 'Invalid card issuer',
    }
    
    return errorMessages[responseCode] || `Transaction failed (Code: ${responseCode})`
  }

  static isSuccess(response: any): boolean {
    // For REST API, success might be different than '000' in Response
    // Usually it returns a JSON with success: true or similar
    // Or it still has a Response field.
    return response.Response === '000' || response.success === true || response.status === 'success'
  }
}

export function createTranzilaClient(): TranzilaClient {
  return new TranzilaClient({
    terminalName: process.env.TRANZILA_TERMINAL || '',
    terminalPassword: process.env.TRANZILA_TERMINAL_PASSWORD,
    testMode: process.env.TRANZILA_TEST_MODE === 'true',
  })
}
