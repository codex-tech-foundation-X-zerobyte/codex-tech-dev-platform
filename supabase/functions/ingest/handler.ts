// Request handling for POST /functions/v1/ingest. Pure Web APIs plus an injected database call, so it is unit-testable.
import { LIMITS, sha256Hex, validateBatch } from './validate.ts'

export type RpcResult = { data: unknown; error: { code?: string; message?: string } | null }
export type Deps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>
  ipSalt: string
  now?: () => number
  // Exact browser origins allowed to call this endpoint (for example the app reporting its own errors). Empty by default.
  corsOrigins?: string[]
}

// Only exact http(s) origins are accepted: no wildcard, no path, no query, no credentials. A single trailing slash,
// capital letters and a default port are tolerated and normalised, because the browser sends the plain lower-case origin.
export function parseCorsOriginsDetailed(raw: string | undefined | null): { allowed: string[]; ignored: string[] } {
  const allowed: string[] = []
  const ignored: string[] = []
  for (const entry of (raw ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    try {
      const u = new URL(entry)
      const plain = (u.protocol === 'http:' || u.protocol === 'https:') && !entry.includes('*') && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash
      if (plain) allowed.push(u.origin); else ignored.push(entry)
    } catch { ignored.push(entry) }
  }
  return { allowed, ignored }
}
export const parseCorsOrigins = (raw: string | undefined | null): string[] => parseCorsOriginsDetailed(raw).allowed

const KEY_FORMAT = /^cdx_[0-9a-f]{64}$/
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
// Database error classes that mean "the event data was bad" (malformed value, constraint, out of range).
const BAD_DATA = new Set(['22P02', '22007', '22008', '22023', '23514', '22001', '22003'])

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })
}

async function readBody(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > max) return null
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.byteLength }
  return out
}

// Only headers set by the trusted edge are used; x-forwarded-for can be written by the caller and is ignored.
function clientIp(req: Request): string | null {
  const ip = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? '').trim()
  return ip && ip.length <= 64 ? ip : null
}

function corsFor(req: Request, allowed: string[] | undefined): Record<string, string> | null {
  const origin = req.headers.get('origin')
  if (!origin || !allowed?.includes(origin)) return null
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
    'access-control-expose-headers': 'retry-after',
    ...(req.method === 'OPTIONS' ? { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' } : {}),
  }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const res = await route(req, deps)
  const extra = corsFor(req, deps.corsOrigins)
  if (!extra) return res
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(extra)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

async function route(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'POST, OPTIONS' } })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { allow: 'POST, OPTIONS' })

  const auth = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(\S+)$/i.exec(auth)
  if (!m || !KEY_FORMAT.test(m[1])) return json(401, { error: 'invalid_key' }, { 'www-authenticate': 'Bearer' })

  const type = (req.headers.get('content-type') ?? '').toLowerCase()
  if (!type.startsWith('application/json')) return json(415, { error: 'unsupported_media_type' })

  const body = await readBody(req, LIMITS.maxBodyBytes)
  if (body === null) return json(413, { error: 'payload_too_large' })
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) } catch { return json(400, { error: 'invalid_json' }) }

  const batch = await validateBatch(parsed, (deps.now ?? Date.now)())
  if (batch.fatal === 'batch_too_large') return json(413, { error: 'batch_too_large', max: LIMITS.maxBatch })
  if (batch.fatal) return json(400, { error: 'invalid_body' })
  if (batch.events.length === 0) return json(400, { error: 'no_valid_events', rejected: batch.rejected })

  const ip = clientIp(req)
  const keyHash = '\\x' + (await sha256Hex(m[1]))
  const ipHash = ip ? await sha256Hex(deps.ipSalt + '|' + ip) : null
  let res: RpcResult
  try {
    res = await deps.rpc('ingest_events', { p_key_hash: keyHash, p_ip_hash: ipHash, p_events: batch.events })
  } catch {
    return json(503, { error: 'unavailable' }, { 'retry-after': '30' })
  }
  if (res.error) {
    if (res.error.code && BAD_DATA.has(res.error.code)) return json(400, { error: 'invalid_event' })
    return json(500, { error: 'internal' })
  }
  const d = (res.data ?? {}) as { ok?: boolean; error?: string; accepted?: number; duplicates?: number }
  if (d.ok) return json(200, { accepted: d.accepted ?? 0, duplicates: d.duplicates ?? 0, rejected: batch.rejected })
  switch (d.error) {
    case 'invalid_key': return json(401, { error: 'invalid_key' }, { 'www-authenticate': 'Bearer' })
    case 'rate_limited': return json(429, { error: 'rate_limited' }, { 'retry-after': '60' })
    case 'quota_exceeded': return json(429, { error: 'quota_exceeded' })
    case 'invalid_event': return json(400, { error: 'invalid_event' })
    default: return json(500, { error: 'internal' })
  }
}
