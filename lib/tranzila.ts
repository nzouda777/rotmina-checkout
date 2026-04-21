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
          // terminal_name and others are expected in params
          ...params,
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

  /**
   * Step 3 of 3DS flow: Complete the transaction after user finishes the challenge.
   * POST /v1/transaction/credit_card/3ds/complete
   */
  async complete3DS(trackId: string): Promise<TranzilaResponse> {
    const apiUrl = 'https://api.tranzila.com/v1/transaction/credit_card/3ds/complete'
    const appKey = process.env.TRANZILA_APP_KEY || ''
    const secret = process.env.TRANZILA_SECRET || ''
    const time = Math.round(Date.now() / 1000)
    const nonce = this.makeNonce(80)
    const accessToken = this.generateAccessToken(appKey, secret, time, nonce)

    const body = {
      terminal_name: process.env.TRANZILA_TERMINAL || '',
      track_id: trackId,
    }

    console.log('[3DS-COMPLETE] Calling Tranzila 3DS Complete:', { url: apiUrl, body })

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
        body: JSON.stringify(body),
      })

      const text = await response.text()
      console.log('[3DS-COMPLETE] Response:', text)

      if (!response.ok) {
        throw new Error(`3DS Complete failed: ${response.statusText} (${response.status})`)
      }

      return JSON.parse(text) as TranzilaResponse
    } catch (err) {
      console.error('[3DS-COMPLETE] Exception:', err)
      throw err
    }
  }

  /**
   * Initialize Bit payment.
   * POST /v1/transaction/bit/init
   */
  async initBit(params: any): Promise<any> {
    const apiUrl = 'https://api.tranzila.com/v1/transaction/bit/init'
    const appKey = process.env.TRANZILA_APP_KEY || ''
    const secret = process.env.TRANZILA_SECRET || ''
    const time = Math.round(Date.now() / 1000)
    const nonce = this.makeNonce(80)
    const accessToken = this.generateAccessToken(appKey, secret, time, nonce)

    console.log('[BIT-DEBUG] Method: POST', { 
      url: apiUrl, 
      headers: {
        'X-tranzila-api-app-key': appKey,
        'X-tranzila-api-request-time': String(time),
        'X-tranzila-api-nonce': nonce,
      }
    })

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, application/xml, multipart/form-data',
          'X-tranzila-api-app-key': appKey,
          'X-tranzila-api-request-time': String(time),
          'X-tranzila-api-nonce': nonce,
          'X-tranzila-api-access-token': accessToken,
        },
        body: JSON.stringify(params),
      })

      const text = await response.text()
      console.log('[BIT-DEBUG] Raw Response Body:', text)

      if (!response.ok) {
        console.error('[BIT-DEBUG] Response NOT OK:', response.status, response.statusText)
        throw new Error(`Bit Init failed: ${response.statusText} (${response.status})`)
      }

      const result = JSON.parse(text)
      console.log('[BIT-DEBUG] Parsed Result:', result)
      return result
    } catch (err) {
      console.error('[BIT-DEBUG] Exception during initBit:', err)
      throw err
    }
  }

  static isSuccess(response: any): boolean {
    if (!response) return false

    // Explicit error_code field (from 3DS complete response)
    // error_code: 0 = success, any other number = failure
    if (typeof response.error_code === 'number') {
      if (response.error_code === 0) return true
      return false
    }
    // error_code as non-zero truthy value (string, etc.)
    if (response.error_code) return false

    // 3DS complete: nested transaction_result with processor_response_code
    if (response.transaction_result?.processor_response_code === '000') return true

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

    // error_code from 3DS complete response (0 = success, non-zero = error)
    if (typeof response.error_code === 'number' && response.error_code !== 0) {
      return response.message || `Transaction error (code: ${response.error_code})`
    }
    if (response.error_code && response.error_code !== 0) {
      let msg = response.message || 'Validation error'
      if (response.mismatch_info && Array.isArray(response.mismatch_info)) {
        const details = response.mismatch_info
          .map((m: any) => `${(m.data_path || []).join('.')}: ${m.keyword || 'invalid type'}`)
          .join(', ')
        if (details) msg += ` (${details})`
      }
      return msg
    }

    // Check nested transaction_result for processor errors
    const txnResult = response.transaction_result
    if (txnResult?.processor_response_code && txnResult.processor_response_code !== '000') {
      return `Transaction failed (processor code: ${txnResult.processor_response_code})`
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