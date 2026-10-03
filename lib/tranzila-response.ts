/**
 * Reads the human-relevant fields out of any Tranzila response shape:
 *   - legacy callback params      { Response, ConfirmationCode, ... }
 *   - REST / 3DS-complete         { error_code, message, transaction_result: {...} }
 *   - Hosted Fields SDK result    { transaction_response: {...} }
 *   - SDK validation error        { error, error_description, messages: [{ code, message, param }] }
 *
 * Pure — used by the server routes, the checkout and the admin panel.
 */

export interface GatewayField {
  key: string
  value: string
}

const str = (v: unknown): string | undefined => {
  if (v == null || v === '') return undefined
  if (typeof v === 'string') return v.trim() || undefined
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return undefined
}

// Keys that carry the gateway's own explanation, in priority order.
const TEXT_KEYS = [
  'processor_response_text', 'response_text', 'response_message', 'error_message',
  'error_description', 'message', 'reason', 'status_description',
] as const

function messagesArray(r: any): { code?: string; message?: string; param?: string }[] {
  const list = Array.isArray(r?.messages) ? r.messages : Array.isArray(r?.errors) ? r.errors : []
  return list.filter((m: unknown) => m && typeof m === 'object')
}

/**
 * Turns `mismatch_info` (JSON-schema errors on API code 20003/20004) into
 * "payment_plan: type, sum: minimum" — i.e. which field we sent wrong.
 */
export function mismatchSummary(info: unknown): string | undefined {
  if (!Array.isArray(info) || !info.length) return undefined
  const parts = info.slice(0, 10).map((m: any) => {
    const path = Array.isArray(m?.data_path) ? m.data_path.join('.') : str(m?.data_path) || str(m?.instance_path) || str(m?.property) || '?'
    const why = str(m?.message) || str(m?.keyword) || 'invalid'
    return `${path}: ${why}`
  })
  return parts.join(', ')
}

/** Tranzila's own wording for why the transaction failed, or undefined if it gave none. */
export function gatewayMessage(response: any): string | undefined {
  if (!response || typeof response !== 'object') return undefined

  const mismatch = mismatchSummary(response.mismatch_info)
  const top = str(response.message) || str(response.error_description)
  if (mismatch) return top ? `${top} (${mismatch})` : mismatch

  const msgs = messagesArray(response)
    .map((m) => [str(m.message), str(m.param) && `(${m.param})`].filter(Boolean).join(' '))
    .filter(Boolean)
  if (msgs.length) return msgs.join(' · ')

  for (const nested of [response.transaction_result, response.transaction_response]) {
    if (!nested || typeof nested !== 'object') continue
    for (const k of TEXT_KEYS) {
      const v = str(nested[k])
      if (v) return v
    }
    const e = str(nested.error)
    if (e) return e
  }

  for (const k of TEXT_KEYS) {
    const v = str(response[k])
    if (v) return v
  }
  return undefined
}

/** Flat list of the fields worth showing to an admin (no card data beyond last 4). */
export function gatewayFields(response: any): GatewayField[] {
  if (!response || typeof response !== 'object') return []
  const out: GatewayField[] = []
  const push = (key: string, v: unknown) => {
    const s = str(v)
    if (s && !out.some((f) => f.key === key)) out.push({ key, value: s })
  }

  push('Response', response.Response)
  push('error_code', response.error_code)
  push('error', response.error)
  push('error_description', response.error_description)
  push('message', response.message)

  push('mismatch_info', mismatchSummary(response.mismatch_info))

  messagesArray(response).forEach((m, i) => {
    const n = messagesArray(response).length > 1 ? `[${i}]` : ''
    push(`messages${n}.code`, m.code)
    push(`messages${n}.message`, m.message)
    push(`messages${n}.param`, m.param)
  })

  for (const [prefix, nested] of [
    ['transaction_result', response.transaction_result],
    ['transaction_response', response.transaction_response],
  ] as const) {
    if (!nested || typeof nested !== 'object') continue
    for (const k of ['processor_response_code', 'approved', 'success', 'status', ...TEXT_KEYS, 'error', 'auth_number', 'transaction_id']) {
      push(`${prefix}.${k}`, nested[k])
    }
  }

  push('ConfirmationCode', response.ConfirmationCode)
  push('index', response.index)
  push('Tempref', response.Tempref)
  return out
}

const SENSITIVE = /^(thtk|token|tranzilatk|ccno|credit_card_number|cvv|mycvv|expdate|myid|pdesc|password|terminal_password)$/i

/**
 * Copy of a gateway response safe to persist: drops tokens / card data, caps size.
 * Used by the checkout before sending the SDK result to the server.
 */
export function sanitizeGatewayResponse(response: any, maxLen = 4000): Record<string, unknown> | undefined {
  if (!response || typeof response !== 'object') return undefined
  const clean = (v: any, depth: number): any => {
    if (depth > 4) return undefined
    if (Array.isArray(v)) return v.slice(0, 10).map((x) => clean(x, depth + 1))
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) {
        if (SENSITIVE.test(k) || typeof x === 'function') continue
        o[k] = clean(x, depth + 1)
      }
      return o
    }
    return typeof v === 'string' ? v.slice(0, 500) : v
  }
  const out = clean(response, 0)
  try {
    return JSON.stringify(out).length <= maxLen ? out : { _truncated: true, ...Object.fromEntries(gatewayFields(response).map((f) => [f.key, f.value])) }
  } catch {
    return undefined
  }
}
