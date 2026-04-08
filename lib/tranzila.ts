import type { TranzilaConfig, TranzilaChargeParams, TranzilaResponse } from './types'

const DEFAULT_TRANZILA_API_URL = 'https://api.tranzila.com/v1/transaction/credit_card/create'

export class TranzilaClient {
  private config: TranzilaConfig

  constructor(config: TranzilaConfig) {
    this.config = config
  }

  async charge(params: TranzilaChargeParams): Promise<TranzilaResponse> {
    const formData = new URLSearchParams()
    
    formData.append('supplier', this.config.terminalName)
    if (this.config.terminalPassword) {
      formData.append('TranzilaPW', this.config.terminalPassword)
    }
    
    // Add all charge parameters
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value))
      }
    })

    // Response format
    formData.append('response_return_format', 'json')

    const apiUrl = process.env.TRANZILA_API_URL || DEFAULT_TRANZILA_API_URL

    // Detailed debug logging (obfuscating card number)
    const debugData = new URLSearchParams(formData)
    const ccno = debugData.get('ccno')
    if (ccno) {
      debugData.set('ccno', ccno.substring(0, 6) + '...' + ccno.substring(ccno.length - 4))
    }
    const cvv = debugData.get('mycvv')
    if (cvv) {
      debugData.set('mycvv', '***')
    }
    const pw = debugData.get('TranzilaPW')
    if (pw) {
      debugData.set('TranzilaPW', '***')
    }

    console.log('[DEBUG] TRANZILA REQUEST:', {
      url: apiUrl,
      method: 'POST',
      body: debugData.toString(),
    })
    function makeid(length: any) {
        var result           = '';
        var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var charactersLength = characters.length;
        for ( var i = 0; i < length; i++ ) {
          result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }
    let nonce = makeid(80)
    var time = Math.round((new Date()).getTime() / 1000);
console.log('apiUrl', apiUrl, 'nonce', nonce, 'time', time, 'formData', formData.toString(), 'api key', process.env.TRANZILA_API_KEY, 'api secret', process.env.TRANZILA_SECRET, 'terminal name', process.env.TRANZILA_TERMINAL, 'idempotency key', process.env.IDEMPOTENCY_KEY_SECRET)
      
    let response
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // 'Accept': 'application/json, text/javascript, */*; q=0.01',
          // 'Accept-Language': 'en-US,en;q=0.9,he;q=0.8',
          // 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          // 'Referer': 'https://' + (process.env.SHOPIFY_STORE_DOMAIN || 'tranzila.com'),
          // 'Origin': 'https://' + (process.env.SHOPIFY_STORE_DOMAIN || 'tranzila.com'),
          'X-tranzila-api-app-key': process.env.TRANZILA_API_KEY || '',
          'X-tranzila-api-request-time': String(time),
          'X-tranzila-api-nonce': nonce,
          'X-tranzila-api-access-token': process.env.IDEMPOTENCY_KEY_SECRET || ''
        },
        body: formData.toString(),
      })
    } catch (fetchErr) {
      console.error('[DEBUG] TRANZILA FETCH EXCEPTION:', fetchErr)
      throw fetchErr
    }

    const text = await response.text()
    
    if (!response.ok) {
      console.error('[DEBUG] TRANZILA ERROR RESPONSE:', {
        status: response.status,
        statusText: response.statusText,
        body: text,
      })
      throw new Error(`Tranzila request failed: ${response.statusText} (${response.status})`)
    }

    try {
      return JSON.parse(text) as TranzilaResponse
    } catch {
      // Parse URL-encoded response if JSON parsing fails
      const parsed: Record<string, string> = {}
      text.split('&').forEach(pair => {
        const [key, value] = pair.split('=')
        if (key) {
          parsed[decodeURIComponent(key)] = decodeURIComponent(value || '')
        }
      })
      return parsed as unknown as TranzilaResponse
    }
  }

  static getErrorMessage(responseCode: string): string {
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

  static isSuccess(response: TranzilaResponse): boolean {
    return response.Response === '000'
  }
}

export function createTranzilaClient(): TranzilaClient {
  return new TranzilaClient({
    terminalName: process.env.TRANZILA_TERMINAL || '',
    terminalPassword: process.env.TRANZILA_TERMINAL_PASSWORD,
    testMode: process.env.TRANZILA_TEST_MODE === 'true',
  })
}
