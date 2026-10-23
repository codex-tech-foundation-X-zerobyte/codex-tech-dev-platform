import { describe, expect, it, vi } from 'vitest'
import { LIMITS, fingerprintOf, normalizeMessage, redactString, sha256Hex, topFrame, validateBatch } from './validate.ts'
import { handle, parseCorsOrigins, parseCorsOriginsDetailed, type Deps } from './handler.ts'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const KEY = 'cdx_' + 'a1'.repeat(32)
const id = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ev = (o: Record<string, unknown> = {}) => ({ event_id: id(), type: 'custom', severity: 'info', occurred_at: '2026-10-21T11:59:00Z', ...o })
const errEv = (o: Record<string, unknown> = {}) => ev({ type: 'error', severity: 'error', error: { type: 'TypeError', message: 'boom 42', stack: 'TypeError: boom\n    at confirmOrder (/srv/app/src/checkout.ts:88:21)' }, ...o })

describe('validation: accepted shapes', () => {
  it('accepts an array, an events wrapper and a single event', async () => {
    expect((await validateBatch([ev()], NOW)).events).toHaveLength(1)
    expect((await validateBatch({ events: [ev()] }, NOW)).events).toHaveLength(1)
    expect((await validateBatch(ev(), NOW)).events).toHaveLength(1)
  })
  it('defaults severity and normalises the event id and time', async () => {
    const r = await validateBatch([{ event_id: id().toUpperCase(), type: 'error', occurred_at: '2026-10-21T13:00:00+01:00', error: { type: 'E', message: 'm' } }], NOW)
    expect(r.rejected).toEqual([])
    expect(r.events[0].severity).toBe('error')
    expect(r.events[0].event_id).toBe(id())
    expect(r.events[0].occurred_at).toBe('2026-10-21T12:00:00.000Z')
  })
  it('adds a 64-character fingerprint to error events only', async () => {
    const r = await validateBatch([errEv(), ev({ event_id: id(2) })], NOW)
    expect(r.events[0].fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(r.events[1].fingerprint).toBeUndefined()
  })
})

describe('validation: rejections', () => {
  const bad = async (e: unknown) => (await validateBatch([e], NOW)).rejected[0]?.reason
  it('rejects unknown and server-owned fields', async () => {
    expect(await bad(ev({ received_at: '2026-10-21T12:00:00Z' }))).toMatch(/unknown field/)
    expect(await bad(ev({ environment: 'production' }))).toMatch(/unknown field/)
    expect(await bad(ev({ project_id: id(9) }))).toMatch(/unknown field/)
    expect(await bad(ev({ org_id: id(9) }))).toMatch(/unknown field/)
  })
  it('rejects bad ids, types, severities and versions', async () => {
    expect(await bad(ev({ event_id: 'nope' }))).toMatch(/UUID/)
    expect(await bad(ev({ type: 'metric' }))).toMatch(/type/)
    expect(await bad(ev({ severity: 'loud' }))).toMatch(/severity/)
    expect(await bad(ev({ schema_version: 2 }))).toMatch(/schema_version/)
    expect(await bad('text')).toMatch(/object/)
  })
  it('enforces the timestamp window', async () => {
    expect(await bad(ev({ occurred_at: '2026-10-01T00:00:00Z' }))).toMatch(/7 days/)
    expect(await bad(ev({ occurred_at: '2026-10-21T12:06:00Z' }))).toMatch(/future/)
    expect(await bad(ev({ occurred_at: '2026-10-21T11:00:00' }))).toMatch(/time zone/)
    expect(await bad(ev({ occurred_at: '2026-13-45T11:00:00Z' }))).toMatch(/valid time/)
    expect((await validateBatch([ev({ occurred_at: '2026-10-21T12:04:00Z' })], NOW)).events).toHaveLength(1)
  })
  it('requires an error object on error events and checks its shape', async () => {
    expect(await bad(ev({ type: 'error' }))).toMatch(/error object/)
    expect(await bad(errEv({ error: { type: 'E' } }))).toMatch(/type and a message/)
    expect(await bad(errEv({ error: { type: 'E', message: 'm', stack: 'x'.repeat(LIMITS.maxStackChars + 1) } }))).toMatch(/stack/)
  })
  it('keeps attributes flat and bounded', async () => {
    expect(await bad(ev({ attributes: { a: { b: 1 } } }))).toMatch(/flat/)
    expect(await bad(ev({ attributes: { a: [1] } }))).toMatch(/flat/)
    expect(await bad(ev({ attributes: { a: 'x'.repeat(LIMITS.maxStringChars + 1) } }))).toMatch(/too long/)
    expect(await bad(ev({ attributes: { ['k'.repeat(65)]: 1 } }))).toMatch(/key/)
    expect(await bad(ev({ attributes: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i])) }))).toMatch(/too many/)
    expect(await bad(ev({ attributes: { n: Infinity } }))).toMatch(/finite/)
  })
  it('rejects oversized events and bad trace ids', async () => {
    expect(await bad(ev({ attributes: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 'x'.repeat(1500)])) }))).toMatch(/too large/)
    expect(await bad(ev({ trace_id: 'has space' }))).toMatch(/trace_id/)
  })
  it('keeps good events when others in the batch are bad', async () => {
    const r = await validateBatch([ev(), ev({ event_id: 'bad' }), ev({ event_id: id(3) })], NOW)
    expect(r.events).toHaveLength(2)
    expect(r.rejected).toEqual([{ index: 1, reason: 'event_id must be a UUID' }])
  })
  it('rejects repeats of the same id inside one batch', async () => {
    const r = await validateBatch([ev(), ev()], NOW)
    expect(r.events).toHaveLength(1)
    expect(r.rejected[0].reason).toMatch(/duplicate/)
  })
  it('limits the batch size and refuses empty or foreign bodies', async () => {
    expect((await validateBatch(Array.from({ length: LIMITS.maxBatch }, (_, i) => ev({ event_id: id(i + 1) })), NOW)).events).toHaveLength(100)
    expect((await validateBatch(Array.from({ length: 101 }, (_, i) => ev({ event_id: id(i + 1) })), NOW)).fatal).toBe('batch_too_large')
    expect((await validateBatch([], NOW)).fatal).toBe('invalid_body')
    expect((await validateBatch('x', NOW)).fatal).toBe('invalid_body')
    expect((await validateBatch({ hello: 1 }, NOW)).fatal).toBe('invalid_body')
    expect((await validateBatch(null, NOW)).fatal).toBe('invalid_body')
  })
})

describe('redaction', () => {
  it('hides sensitive attribute names, whatever the value', async () => {
    const r = await validateBatch([ev({ attributes: { password: 'hunter2', Authorization: 'x', api_key: 'k', cardNumber: '4111111111111111', user_id: 'u1', retries: 3, token_count: 5 } })], NOW)
    expect(r.events[0].attributes).toMatchObject({ password: '[redacted]', Authorization: '[redacted]', api_key: '[redacted]', cardNumber: '[redacted]', user_id: 'u1', retries: 3 })
  })
  it('scrubs secrets inside free text, messages and stacks', async () => {
    const jwt = 'eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeK'
    const r = await validateBatch([errEv({ attributes: { note: `Bearer abcdefghij1234 and ${KEY}` }, error: { type: 'E', message: `bad token ${jwt}`, stack: `at f (x.ts:1:1) card 4111 1111 1111 1111` } })], NOW)
    const e = r.events[0]
    expect(e.attributes.note).toBe('Bearer [redacted] and [redacted-key]')
    expect(e.error?.message).toBe('bad token [redacted-jwt]')
    expect(e.error?.stack).toContain('[redacted-card]')
  })
  it('leaves ordinary numbers and invalid card-like numbers alone', () => {
    expect(redactString('order 1234567890123456 failed')).toBe('order 1234567890123456 failed')
    expect(redactString('took 250 ms')).toBe('took 250 ms')
  })
})

describe('fingerprints', () => {
  it('ignore numbers, ids and line numbers so one bug is one group', async () => {
    const a = await fingerprintOf({ type: 'E', message: 'user 41 not found', stack: 'E\n  at f (/srv/a/x.ts:10:5)' })
    const b = await fingerprintOf({ type: 'E', message: 'user 9999 not found', stack: 'E\n  at f (/other/path/x.ts:88:1)' })
    expect(a).toBe(b)
  })
  it('differ for different causes', async () => {
    const a = await fingerprintOf({ type: 'E', message: 'user not found', stack: 'at f (x.ts:1:1)' })
    expect(await fingerprintOf({ type: 'F', message: 'user not found', stack: 'at f (x.ts:1:1)' })).not.toBe(a)
    expect(await fingerprintOf({ type: 'E', message: 'order not found', stack: 'at f (x.ts:1:1)' })).not.toBe(a)
    expect(await fingerprintOf({ type: 'E', message: 'user not found', stack: 'at g (x.ts:1:1)' })).not.toBe(a)
  })
  it('normalise helpers', () => {
    expect(normalizeMessage('id 3f2c9a1b-1111-4222-8333-444455556666 took 12ms\nsecond line')).toBe('id # took #ms')
    expect(topFrame('Error: x\n  File "a.py", line 12, in run')).toContain('File "a.py"')
    expect(topFrame(undefined)).toBe('')
  })
  it('SHA-256 matches the standard test vector (the database hashes keys the same way)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

// ---------- request handling ----------
type Call = { fn: string; args: Record<string, unknown> }
function deps(reply: unknown = { data: { ok: true, accepted: 1, duplicates: 0 }, error: null }): Deps & { calls: Call[] } {
  const calls: Call[] = []
  return { calls, ipSalt: 'salt', now: () => NOW, rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return reply as never }) }
}
const post = (body: unknown, h: Record<string, string> = {}) =>
  new Request('https://x.test/ingest', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...h }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('request handling', () => {
  it('accepts a valid batch and passes only validated data to the database', async () => {
    const d = deps()
    const res = await handle(post({ events: [errEv()] }, { 'cf-connecting-ip': '203.0.113.5' }), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0, rejected: [] })
    expect(d.calls).toHaveLength(1)
    const a = d.calls[0].args
    expect(a.p_key_hash).toBe('\\x' + (await sha256Hex(KEY)))
    expect(a.p_ip_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(a)).not.toContain(KEY)
    expect(JSON.stringify(a)).not.toContain('203.0.113.5')
  })
  it('reports rejected events but still stores the good ones', async () => {
    const res = await handle(post([ev(), ev({ event_id: 'bad' })]), deps())
    const j = await res.json()
    expect(res.status).toBe(200)
    expect(j.rejected).toHaveLength(1)
  })
  it('answers OPTIONS and refuses other methods, never enabling browser CORS', async () => {
    const o = await handle(new Request('https://x.test/', { method: 'OPTIONS' }), deps())
    expect(o.status).toBe(204)
    expect(o.headers.get('access-control-allow-origin')).toBeNull()
    expect((await handle(new Request('https://x.test/', { method: 'GET' }), deps())).status).toBe(405)
  })
  it('refuses missing or malformed keys without touching the database', async () => {
    const d = deps()
    expect((await handle(new Request('https://x.test/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), d)).status).toBe(401)
    expect((await handle(post([ev()], { authorization: 'Bearer cdx_short' }), d)).status).toBe(401)
    expect((await handle(post([ev()], { authorization: 'Basic abc' }), d)).status).toBe(401)
    expect(d.calls).toHaveLength(0)
  })
  it('requires JSON, valid JSON and a sane body', async () => {
    const d = deps()
    expect((await handle(post('x', { 'content-type': 'text/plain' }), d)).status).toBe(415)
    expect((await handle(post('{not json'), d)).status).toBe(400)
    expect((await handle(post({ nothing: true }), d)).status).toBe(400)
    expect((await handle(post([ev({ event_id: 'bad' })]), d)).status).toBe(400)
    expect(d.calls).toHaveLength(0)
  })
  it('enforces the body size limit by header and by streaming', async () => {
    const d = deps()
    expect((await handle(post([ev()], { 'content-length': String(LIMITS.maxBodyBytes + 1) }), d)).status).toBe(413)
    const big = '[' + '"' + 'x'.repeat(LIMITS.maxBodyBytes) + '"]'
    expect((await handle(post(big), d)).status).toBe(413)
    expect(d.calls).toHaveLength(0)
  })
  it('refuses oversized batches', async () => {
    const d = deps()
    const res = await handle(post(Array.from({ length: 101 }, (_, i) => ev({ event_id: id(i + 1) }))), d)
    expect(res.status).toBe(413)
    expect(d.calls).toHaveLength(0)
  })
  it('ignores x-forwarded-for, so callers cannot choose their own rate-limit identity', async () => {
    const d = deps()
    await handle(post([ev()], { 'x-forwarded-for': '1.2.3.4' }), d)
    expect(d.calls[0].args.p_ip_hash).toBeNull()
  })
  it('maps database outcomes to honest status codes', async () => {
    const reply = (d: unknown) => ({ data: d, error: null })
    expect((await handle(post([ev()]), deps(reply({ ok: false, error: 'invalid_key' })))).status).toBe(401)
    const rl = await handle(post([ev()]), deps(reply({ ok: false, error: 'rate_limited' })))
    expect(rl.status).toBe(429)
    expect(rl.headers.get('retry-after')).toBe('60')
    const q = await handle(post([ev()]), deps(reply({ ok: false, error: 'quota_exceeded' })))
    expect(q.status).toBe(429)
    expect((await q.json()).error).toBe('quota_exceeded')
    expect((await handle(post([ev()]), deps(reply({ ok: false, error: 'something_else' })))).status).toBe(500)
  })
  it('turns data errors into 400 and everything else into a generic 500 with no internals', async () => {
    expect((await handle(post([ev()]), deps({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid: "x"' } }))).status).toBe(400)
    const res = await handle(post([ev()]), deps({ data: null, error: { code: 'XX000', message: 'relation monitor.events secret detail' } }))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/relation|secret/)
    const down = deps(); down.rpc = async () => { throw new Error('network down: db.internal:5432') }
    const r3 = await handle(post([ev()]), down)
    expect(r3.status).toBe(503)
    expect(JSON.stringify(await r3.json())).not.toMatch(/internal|5432/)
  })
  it('sets safe response headers', async () => {
    const res = await handle(post([ev()]), deps())
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('browser access (CORS) is opt-in and exact', () => {
  const allowed = 'https://app.example.com'
  const withCors = (d = deps()) => Object.assign(d, { corsOrigins: [allowed] })
  it('adds no CORS headers by default, so browsers cannot call the endpoint', async () => {
    const res = await handle(post([ev()], { origin: allowed }), deps())
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    const pre = await handle(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin: allowed } }), deps())
    expect(pre.headers.get('access-control-allow-origin')).toBeNull()
  })
  it('answers the preflight for an allowed origin and no other', async () => {
    const ok = await handle(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin: allowed, 'access-control-request-method': 'POST' } }), withCors())
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe(allowed)
    expect(ok.headers.get('access-control-allow-headers')).toBe('authorization, content-type')
    expect(ok.headers.get('vary')).toBe('Origin')
    const other = await handle(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), withCors())
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
  })
  it('adds the headers to real responses too, including errors', async () => {
    expect((await handle(post([ev()], { origin: allowed }), withCors())).headers.get('access-control-allow-origin')).toBe(allowed)
    const bad = await handle(new Request('https://x.test/', { method: 'POST', headers: { origin: allowed } }), withCors())
    expect(bad.status).toBe(401)
    expect(bad.headers.get('access-control-allow-origin')).toBe(allowed)
    const rl = await handle(post([ev()], { origin: allowed }), withCors(deps({ data: { ok: false, error: 'rate_limited' }, error: null })))
    expect(rl.headers.get('access-control-expose-headers')).toBe('retry-after')
    expect(await handle(post([ev()], { origin: 'https://evil.example' }), withCors()).then((r) => r.headers.get('access-control-allow-origin'))).toBeNull()
  })
  it('only accepts exact origins from configuration', () => {
    expect(parseCorsOrigins('https://a.com, http://localhost:5173')).toEqual(['https://a.com', 'http://localhost:5173'])
    expect(parseCorsOrigins('*')).toEqual([])
    expect(parseCorsOrigins('https://*.example.com')).toEqual([])
    expect(parseCorsOrigins('https://a.com/path')).toEqual([])
    expect(parseCorsOrigins('a.com')).toEqual([])
    expect(parseCorsOrigins(undefined)).toEqual([])
    expect(parseCorsOrigins('')).toEqual([])
  })
  it('forgives the usual typos: a trailing slash, capitals and a default port', () => {
    expect(parseCorsOrigins('https://codex-tech-dev-platform.vercel.app/')).toEqual(['https://codex-tech-dev-platform.vercel.app'])
    expect(parseCorsOrigins('HTTPS://App.Example.com')).toEqual(['https://app.example.com'])
    expect(parseCorsOrigins('https://a.com:443')).toEqual(['https://a.com'])
    expect(parseCorsOrigins('http://localhost:5173/')).toEqual(['http://localhost:5173'])
    expect(parseCorsOrigins(' https://a.com , https://b.com ')).toEqual(['https://a.com', 'https://b.com'])
  })
  it('still refuses anything broader than one exact origin, and says what it ignored', () => {
    const r = parseCorsOriginsDetailed('https://a.com, *, https://*.b.com, https://c.com/x, https://u:p@d.com, https://e.com?x=1, ftp://f.com, nonsense')
    expect(r.allowed).toEqual(['https://a.com'])
    expect(r.ignored).toEqual(['*', 'https://*.b.com', 'https://c.com/x', 'https://u:p@d.com', 'https://e.com?x=1', 'ftp://f.com', 'nonsense'])
  })
  it('matches the origin the browser really sends once a trailing slash was configured', async () => {
    const d = Object.assign(deps(), { corsOrigins: parseCorsOrigins('https://codex-tech-dev-platform.vercel.app/') })
    const pre = await handle(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin: 'https://codex-tech-dev-platform.vercel.app' } }), d)
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://codex-tech-dev-platform.vercel.app')
  })
})
