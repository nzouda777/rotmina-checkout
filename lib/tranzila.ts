import crypto from 'crypto'
import type { TranzilaConfig, TranzilaChargeParams, TranzilaResponse } from './types'
import { gatewayMessage } from './tranzila-response'
import { tranzilaCodeMessage } from './tranzila-codes'

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

  async getHandshakeToken(sum?: number, currency?: string): Promise<string | null> {
    const password = process.env.TRANZILA_TERMINAL_PASSWORD
    if (!password || password === 'your_terminal_password') {
      console.error('[TRANZILA-HANDSHAKE] TRANZILA_TERMINAL_PASSWORD not configured.')
      return null
    }

    let apiUrl = `https://api.tranzila.com/v1/handshake/create?supplier=${this.config.terminalName}&TranzilaPW=${password}`
    if (sum !== undefined) {
      apiUrl += `&sum=${sum.toFixed(2)}`
    }

    console.log(`[TRANZILA-HANDSHAKE] URL: ${apiUrl}`)

    const maskedPw = `${password.substring(0, 3)}***`
    console.log(`[TRANZILA-HANDSHAKE] GET supplier=${this.config.terminalName} | pw=${maskedPw} | sum=${sum} | currency=${currency}`)

    try {
      const response = await fetch(apiUrl, { method: 'GET' })
      const text = await response.text()
      console.log(`[TRANZILA-HANDSHAKE] status=${response.status} | body=${text.substring(0, 200)}`)

      if (!response.ok) {
        console.error(`[TRANZILA-HANDSHAKE] HTTP error ${response.status}: ${text}`)
        return null
      }

      const raw = text.trim()

      if (raw.startsWith('thtk=')) {
        const token = raw.slice(5)
        console.log(`[TRANZILA-HANDSHAKE] Token: ${token.substring(0, 10)}…`)
        return token
      }

      if (raw && !raw.toLowerCase().startsWith('{') && !raw.toLowerCase().includes('error') && !raw.toLowerCase().includes('invalid')) {
        console.log(`[TRANZILA-HANDSHAKE] Token (no prefix): ${raw.substring(0, 10)}…`)
        return raw
      }

      console.error(`[TRANZILA-HANDSHAKE] Unexpected response: ${text}`)
      return null
    } catch (e) {
      console.error('[TRANZILA-HANDSHAKE] Error:', e)
      return null
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

    // Errors array or string → always false
    if (Array.isArray(response.errors) && response.errors.length > 0) return false
    if (response.error) return false

    // Non-zero error_code → API-level failure
    if (typeof response.error_code === 'number' && response.error_code !== 0) return false
    if (response.error_code && response.error_code !== 0) return false

    // transaction_result is the authoritative source for whether the charge was approved.
    // error_code: 0 only means the API call was accepted, NOT that the charge succeeded.
    if (response.transaction_result) {
      const txn = response.transaction_result
      const processorCode = txn.processor_response_code
      const approved = txn.approved
      const txnStatus = typeof txn.status === 'string' ? txn.status.toLowerCase() : null

      // Explicit decline flags
      if (approved === false) {
        console.log('[TRANZILA] transaction_result.approved=false → DECLINED')
        return false
      }
      if (txnStatus && ['declined', 'failed', 'error', 'rejected'].includes(txnStatus)) {
        console.log(`[TRANZILA] transaction_result.status=${txn.status} → DECLINED`)
        return false
      }
      if (processorCode && processorCode !== '000') {
        console.log(`[TRANZILA] processor_response_code=${processorCode} → DECLINED`)
        return false
      }

      // Require at least one positive success indicator from the processor
      const hasPositiveConfirmation =
        processorCode === '000' ||
        approved === true ||
        !!txn.auth_number ||
        txnStatus === 'approved' ||
        txnStatus === 'success'

      if (!hasPositiveConfirmation) {
        console.log('[TRANZILA] transaction_result present but no positive confirmation → DECLINED', JSON.stringify(txn))
        return false
      }

      return true
    }

    // Legacy Response field (non-3DS responses)
    if (response.Response) {
      return response.Response === '000'
    }

    // Explicit status field
    if (typeof response.status === 'string') {
      const s = response.status.toLowerCase()
      if (s === 'success' || s === 'approved' || s === 'ok') return true
      if (s === 'failed' || s === 'error' || s === 'declined') return false
    }

    // Explicit success field
    if (response.success === true) return true
    if (response.success === false) return false

    // error_code: 0 with no transaction_result — require a confirmation code
    if (typeof response.error_code === 'number' && response.error_code === 0) {
      if (response.ConfirmationCode || response.transaction_id || response.index) return true
      // error_code: 0 alone is not sufficient proof of payment
      console.log('[TRANZILA] error_code=0 but no confirmation code and no transaction_result → ambiguous, treating as failure')
      return false
    }

    // Confirmation code present without other context
    if (response.ConfirmationCode || response.transaction_id || response.index) return true

    return false
  }

  static getErrorMessage(response: any): string {
    if (!response) return 'Unknown error'

    // Official SHVA / 3DS / API code wording (lib/tranzila-codes.ts), then
    // whatever Tranzila wrote itself (message, messages[], mismatch_info…).
    const txnResult = response.transaction_result || response.transaction_response
    const processorCode = txnResult?.processor_response_code
    const apiCode = response.error_code && Number(response.error_code) !== 0 ? response.error_code : undefined
    const legacyCode = response.Response && response.Response !== '000' ? response.Response : undefined
    const code = (processorCode && processorCode !== '000' ? processorCode : undefined) || apiCode || legacyCode

    const official = code ? tranzilaCodeMessage(code) : undefined
    const gwMessage = gatewayMessage(response)
    if (official && gwMessage && gwMessage !== official) return `${official} — ${gwMessage} (code: ${code})`
    if (official) return `${official} (code: ${code})`
    if (gwMessage) return code ? `${gwMessage} (code: ${code})` : gwMessage
    if (code) return `Transaction failed (code: ${code})`
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