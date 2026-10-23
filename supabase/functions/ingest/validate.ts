// Event Schema v1 (docs/contracts.md, Contract A): strict validation, redaction and error fingerprints.
// Plain TypeScript with no Deno or Node APIs beyond Web Crypto, so it runs in the Edge Function and in unit tests.

export const LIMITS = {
  maxBodyBytes: 512 * 1024,
  maxBatch: 100,
  maxEventBytes: 32 * 1024,
  maxAttributes: 64,
  maxKeyChars: 64,
  maxStringChars: 2048,
  maxNameChars: 200,
  maxErrorTypeChars: 200,
  maxErrorMessageChars: 2000,
  maxStackChars: 16000,
  maxPastMs: 7 * 24 * 3600 * 1000,
  maxFutureMs: 5 * 60 * 1000,
} as const

export const EVENT_TYPES = ['error', 'custom', 'http', 'log'] as const
export const SEVERITIES = ['debug', 'info', 'warning', 'error', 'fatal'] as const
type Scalar = string | number | boolean | null

export type ValidEvent = {
  event_id: string
  type: (typeof EVENT_TYPES)[number]
  severity: (typeof SEVERITIES)[number]
  occurred_at: string
  name?: string
  trace_id?: string
  span_id?: string
  attributes: Record<string, Scalar>
  error?: { type: string; message: string; stack?: string }
  sdk?: { name?: string; version?: string; language?: string }
  fingerprint?: string
}
export type Rejection = { index: number; reason: string }
export type BatchResult = { events: ValidEvent[]; rejected: Rejection[]; fatal?: 'invalid_body' | 'batch_too_large' }

const ALLOWED = new Set(['schema_version', 'event_id', 'type', 'name', 'severity', 'occurred_at', 'trace_id', 'span_id', 'attributes', 'error', 'sdk'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TRACE = /^[A-Za-z0-9_.:-]{1,64}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---------- redaction ----------
const SENSITIVE_KEY = /pass(word|wd)?|secret|token|authorization|auth[_-]?header|api[_-]?key|apikey|private[_-]?key|cookie|session|credential|card|cvv|cvc|pan\b|ssn/i
export const REDACTED = '[redacted]'

function luhn(digits: string): boolean {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) { d *= 2; if (d > 9) d -= 9 }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

export function redactString(s: string): string {
  return s
    .replace(/\bcdx_[0-9a-f]{64}\b/g, '[redacted-key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[redacted-jwt]')
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => (luhn(m.replace(/[ -]/g, '')) ? '[redacted-card]' : m))
}

// ---------- fingerprint ----------
export function normalizeMessage(msg: string): string {
  return msg.split('\n')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}
export function topFrame(stack: string | undefined): string {
  if (!stack) return ''
  const line = stack.split('\n').find((l) => /^\s*(at\s|File\s)/.test(l))
  return (line ?? '').trim().replace(/:\d+(:\d+)?\)?$/, '').replace(/,\s*line\s+\d+/, '').replace(/\(.*[\\/]/, '(').slice(0, 300)
}
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
export function fingerprintOf(e: { type: string; message: string; stack?: string }): Promise<string> {
  return sha256Hex(`${e.type}|${normalizeMessage(e.message)}|${topFrame(e.stack)}`)
}

// ---------- validation ----------
function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v : null
}

async function validateOne(raw: unknown, now: number): Promise<ValidEvent | string> {
  if (!isObj(raw)) return 'event must be an object'
  for (const k of Object.keys(raw)) if (!ALLOWED.has(k)) return `unknown field: ${k.slice(0, 40)}`
  if (JSON.stringify(raw).length > LIMITS.maxEventBytes) return 'event too large'
  if (raw.schema_version !== undefined && raw.schema_version !== 1) return 'unsupported schema_version'
  if (typeof raw.event_id !== 'string' || !UUID.test(raw.event_id)) return 'event_id must be a UUID'
  if (!EVENT_TYPES.includes(raw.type as never)) return 'invalid type'
  const type = raw.type as ValidEvent['type']
  const severity = raw.severity === undefined ? (type === 'error' ? 'error' : 'info') : raw.severity
  if (!SEVERITIES.includes(severity as never)) return 'invalid severity'
  if (typeof raw.occurred_at !== 'string' || !ISO.test(raw.occurred_at)) return 'occurred_at must be ISO 8601 with a time zone'
  const t = Date.parse(raw.occurred_at)
  if (Number.isNaN(t)) return 'occurred_at is not a valid time'
  if (t < now - LIMITS.maxPastMs) return 'occurred_at is more than 7 days old'
  if (t > now + LIMITS.maxFutureMs) return 'occurred_at is in the future'

  const out: ValidEvent = { event_id: raw.event_id.toLowerCase(), type, severity: severity as ValidEvent['severity'], occurred_at: new Date(t).toISOString(), attributes: {} }
  if (raw.name !== undefined) { const n = str(raw.name, LIMITS.maxNameChars); if (n === null) return 'invalid name'; out.name = redactString(n) }
  for (const k of ['trace_id', 'span_id'] as const) {
    if (raw[k] !== undefined) { if (typeof raw[k] !== 'string' || !TRACE.test(raw[k] as string)) return `invalid ${k}`; out[k] = raw[k] as string }
  }
  if (raw.attributes !== undefined) {
    if (!isObj(raw.attributes)) return 'attributes must be a flat object'
    const keys = Object.keys(raw.attributes)
    if (keys.length > LIMITS.maxAttributes) return 'too many attributes'
    for (const k of keys) {
      if (k.length === 0 || k.length > LIMITS.maxKeyChars) return 'attribute key length'
      const v = raw.attributes[k]
      if (v !== null && typeof v === 'object') return 'attributes must be flat (no nested objects or arrays)'
      if (typeof v === 'string') {
        if (v.length > LIMITS.maxStringChars) return 'attribute value too long'
        out.attributes[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactString(v)
      } else if (typeof v === 'number') {
        if (!Number.isFinite(v)) return 'attribute numbers must be finite'
        out.attributes[k] = SENSITIVE_KEY.test(k) ? REDACTED : v
      } else if (typeof v === 'boolean' || v === null) {
        out.attributes[k] = SENSITIVE_KEY.test(k) && v !== null ? REDACTED : v
      } else return 'unsupported attribute value'
    }
  }
  if (type === 'error' && raw.error === undefined) return 'error events need an error object'
  if (raw.error !== undefined) {
    if (!isObj(raw.error)) return 'error must be an object'
    const et = str(raw.error.type, LIMITS.maxErrorTypeChars)
    const em = str(raw.error.message, LIMITS.maxErrorMessageChars)
    if (!et || em === null) return 'error needs a type and a message'
    let stack: string | undefined
    if (raw.error.stack !== undefined) {
      const s = str(raw.error.stack, LIMITS.maxStackChars)
      if (s === null) return 'stack too long'
      stack = redactString(s)
    }
    out.error = { type: et, message: redactString(em), ...(stack === undefined ? {} : { stack }) }
    if (type === 'error') out.fingerprint = await fingerprintOf(out.error)
  }
  if (raw.sdk !== undefined) {
    if (!isObj(raw.sdk)) return 'sdk must be an object'
    const sdk: NonNullable<ValidEvent['sdk']> = {}
    for (const [k, max] of [['name', 50], ['version', 30], ['language', 30]] as const) {
      if (raw.sdk[k] !== undefined) { const v = str(raw.sdk[k], max); if (v === null) return `invalid sdk.${k}`; sdk[k] = v }
    }
    out.sdk = sdk
  }
  return out
}

// Accepts an array, { events: [...] }, or a single event. Bad events are rejected one by one; the rest are kept.
export async function validateBatch(input: unknown, now: number = Date.now()): Promise<BatchResult> {
  let list: unknown[]
  if (Array.isArray(input)) list = input
  else if (isObj(input) && Array.isArray(input.events)) list = input.events
  else if (isObj(input) && 'event_id' in input) list = [input]
  else return { events: [], rejected: [], fatal: 'invalid_body' }
  if (list.length === 0) return { events: [], rejected: [], fatal: 'invalid_body' }
  if (list.length > LIMITS.maxBatch) return { events: [], rejected: [], fatal: 'batch_too_large' }
  const events: ValidEvent[] = []
  const rejected: Rejection[] = []
  const seen = new Set<string>()
  for (let i = 0; i < list.length; i++) {
    const r = await validateOne(list[i], now)
    if (typeof r === 'string') rejected.push({ index: i, reason: r })
    else if (seen.has(r.event_id)) rejected.push({ index: i, reason: 'duplicate event_id in this batch' })
    else { seen.add(r.event_id); events.push(r) }
  }
  return { events, rejected }
}
