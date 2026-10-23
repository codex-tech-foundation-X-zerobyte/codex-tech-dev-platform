// End-to-end: the real request handler talking to a real Postgres that has the migrations applied.
// Skipped unless CODEX_E2E_DB names a LOCAL throwaway database (see supabase/tests/run_local.sh).
// Run: CODEX_E2E_DB=codex_core_test npx vitest run supabase/functions/ingest/e2e.test.ts
import { execFile, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { handle, type Deps } from './handler.ts'

const DB = process.env.CODEX_E2E_DB
const run = (sql: string): string => execFileSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB!, '-c', sql], { encoding: 'utf8' }).trim()
const asUser = (uid: string, sql: string) => run(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false); ${sql}`)
const q = (sql: string) => run(sql)

const rpc: Deps['rpc'] = async (fn, a) => {
  if (fn !== 'ingest_events') throw new Error('unexpected rpc')
  const ip = a.p_ip_hash ? `'${a.p_ip_hash}'` : 'null'
  const sql = `set role service_role; select public.ingest_events('${a.p_key_hash}'::bytea, ${ip}, $j$${JSON.stringify(a.p_events)}$j$::jsonb)`
  try { return { data: JSON.parse(run(sql)), error: null } }
  catch (e) {
    const m = /ERROR:\s+(\w{5})/.exec(String((e as { stderr?: string }).stderr ?? ''))
    return { data: null, error: { code: m?.[1], message: 'db error' } }
  }
}
const deps: Deps = { rpc, ipSalt: 'e2e-salt' }
const uid = (n: number) => `00000000-0000-0000-0000-0000000e2e${String(n).padStart(2, '0')}`
const evId = () => crypto.randomUUID()
const post = (key: string, events: unknown, headers: Record<string, string> = {}) =>
  handle(new Request('https://x.test/ingest', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ events }) }), deps)
const now = () => new Date().toISOString()
const errEvent = (msg: string, line: number, extra: Record<string, unknown> = {}) => ({
  event_id: evId(), type: 'error', occurred_at: now(),
  error: { type: 'TypeError', message: msg, stack: `TypeError: x\n    at confirmOrder (/srv/app/src/checkout.ts:${line}:21)` }, ...extra,
})

describe.skipIf(!DB)('handler against a real database', () => {
  const tag = Math.random().toString(36).slice(2, 8)
  let org = '', project = '', env = '', key = '', keyId = ''
  const setup = () => {
    q(`insert into auth.users (id, email) values ('${uid(1)}', 'e2e-${tag}@x.com') on conflict do nothing`)
    org = JSON.parse(asUser(uid(1), `select public.create_organization('E2E ${tag}', 'e2e-${tag}')`).split('\n').pop()!).id
    project = JSON.parse(asUser(uid(1), `select public.project_create('${org}', 'Svc', 'svc')`).split('\n').pop()!).id
    env = q(`select id from core.environments where project_id = '${project}' and slug = 'production'`)
    const k = JSON.parse(asUser(uid(1), `select public.ingestion_key_create('${env}', 'e2e')`).split('\n').pop()!)
    key = k.key; keyId = k.id
  }

  it('stores events and groups errors across line numbers and ids', async () => {
    setup()
    const res = await post(key, [errEvent('order 1001 failed', 88), errEvent('order 2002 failed', 91), { event_id: evId(), type: 'custom', name: 'signup', occurred_at: now(), attributes: { plan: 'free' } }])
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ accepted: 3, duplicates: 0 })
    expect(q(`select count(*) from monitor.events where environment_id = '${env}'`)).toBe('3')
    expect(q(`select count(*) from monitor.error_groups where project_id = '${project}'`)).toBe('1')
    expect(q(`select event_count from monitor.error_groups where project_id = '${project}'`)).toBe('2')
    expect(q(`select title from monitor.error_groups where project_id = '${project}'`)).toBe('TypeError: order 1001 failed')
  })

  it('treats a re-sent event as a duplicate', async () => {
    const e = { event_id: evId(), type: 'custom', occurred_at: now() }
    expect((await (await post(key, [e])).json()).accepted).toBe(1)
    const again = await (await post(key, [e])).json()
    expect(again).toMatchObject({ accepted: 0, duplicates: 1 })
  })

  it('stores redacted data only', async () => {
    const secret = 'cdx_' + 'ab'.repeat(32)
    const res = await post(key, [errEvent('bad', 5, { attributes: { password: 'hunter2', note: `key ${secret}` } })])
    expect(res.status).toBe(200)
    expect(q(`select count(*) from monitor.events where attributes::text like '%hunter2%' or attributes::text like '%${secret}%'`)).toBe('0')
    expect(q(`select count(*) from monitor.events where attributes ->> 'password' = '[redacted]'`)).toBe('1')
  })

  it('never lets the payload pick the tenant', async () => {
    const res = await post(key, [{ event_id: evId(), type: 'custom', occurred_at: now(), project_id: crypto.randomUUID() }])
    expect(res.status).toBe(400)
  })

  it('stops bad events before the database', async () => {
    const before = q(`select count(*) from monitor.events where project_id = '${project}'`)
    const res = await post(key, [{ event_id: 'nope', type: 'custom', occurred_at: now() }])
    expect(res.status).toBe(400)
    expect(q(`select count(*) from monitor.events where project_id = '${project}'`)).toBe(before)
  })

  it('rejects unknown and revoked keys', async () => {
    expect((await post('cdx_' + '0'.repeat(64), [{ event_id: evId(), type: 'custom', occurred_at: now() }])).status).toBe(401)
    asUser(uid(1), `select public.ingestion_key_revoke('${keyId}')`)
    expect((await post(key, [{ event_id: evId(), type: 'custom', occurred_at: now() }])).status).toBe(401)
  })

  it('throttles a client that keeps guessing keys, then lets other clients through', async () => {
    const k2 = JSON.parse(asUser(uid(1), `select public.ingestion_key_create('${env}', 'e2e-2')`).split('\n').pop()!).key
    for (let i = 0; i < 30; i++) await post('cdx_' + String(i).padStart(64, '0'), [{ event_id: evId(), type: 'custom', occurred_at: now() }], { 'cf-connecting-ip': '198.51.100.77' })
    const blocked = await post(k2, [{ event_id: evId(), type: 'custom', occurred_at: now() }], { 'cf-connecting-ip': '198.51.100.77' })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('60')
    const other = await post(k2, [{ event_id: evId(), type: 'custom', occurred_at: now() }], { 'cf-connecting-ip': '198.51.100.78' })
    expect(other.status).toBe(200)

    // the monthly cap answers 429 quota_exceeded and stores nothing from the refused batch
    q(`insert into monitor.project_limits values ('${project}', (select accepted from monitor.usage where project_id = '${project}'))`)
    const over = await post(k2, [{ event_id: evId(), type: 'custom', occurred_at: now() }], { 'cf-connecting-ip': '198.51.100.79' })
    expect(over.status).toBe(429)
    expect((await over.json()).error).toBe('quota_exceeded')
  })

  it('stores what the app reports about itself, with browser access limited to the allowed site', async () => {
    q(`delete from monitor.project_limits`)
    const self = JSON.parse(asUser(uid(1), `select public.ingestion_key_create('${env}', 'self')`).split('\n').pop()!).key
    const { initSelfMonitor, reportError, resetSelfMonitorForTests } = await import('../../../src/lib/selfMonitor.ts')
    resetSelfMonitorForTests()
    const seen: (string | null)[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers); headers.set('origin', 'https://app.example.com')
      const res = await handle(new Request(url, { ...init, headers }), { ...deps, corsOrigins: ['https://app.example.com'] })
      seen.push(res.headers.get('access-control-allow-origin'))
      return res
    }) as typeof fetch
    try {
      initSelfMonitor({ VITE_SELF_MONITOR_KEY: self, VITE_SELF_MONITOR_URL: 'https://x.test/ingest' })
      reportError(new TypeError('self e2e: cannot read x of undefined'), { source: 'e2e' })
      await new Promise((r) => setTimeout(r, 1500))
    } finally { globalThis.fetch = real; resetSelfMonitorForTests() }
    expect(seen).toEqual(['https://app.example.com'])
    expect(q(`select count(*) from monitor.events where attributes ->> 'app' = 'codex-platform' and attributes ->> 'source' = 'e2e'`)).toBe('1')
    expect(q(`select title from monitor.error_groups where project_id = '${project}' and title like 'TypeError: self e2e%'`)).toBe('TypeError: self e2e: cannot read x of undefined')
  })

  it('accepts everything the sample script sends and turns it into 5 error groups', async () => {
    const key2 = JSON.parse(asUser(uid(1), `select public.ingestion_key_create('${env}', 'sample')`).split('\n').pop()!).key
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', async () => {
        const r = await handle(new Request('https://x.test/', { method: 'POST', headers: { authorization: String(req.headers.authorization), 'content-type': 'application/json' }, body: Buffer.concat(chunks) }), deps)
        res.writeHead(r.status, { 'content-type': 'application/json' }).end(await r.text())
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ingest`
    try {
      const { stdout } = await promisify(execFile)(process.execPath, ['scripts/send-sample-events.mjs'], { env: { PATH: process.env.PATH, CODEX_INGEST_URL: url, CODEX_KEY: key2 } })
      expect(stdout).toContain('accepted 97')
    } finally { await new Promise<void>((r) => { server.close(() => r()) }) }
    expect(q(`select count(*) from monitor.events where attributes ->> 'sample' = 'true'`)).toBe('97')
    expect(q(`select count(distinct fingerprint) from monitor.events where attributes ->> 'sample' = 'true' and type = 'error'`)).toBe('5')
    expect(q(`select count(*) from monitor.events where attributes::text like '%hunter2%'`)).toBe('0')
    const ov = JSON.parse(asUser(uid(1), `select public.monitor_overview('${project}')`).split('\n').pop()!)
    expect(ov.capability.state).toBe('connected')
    expect(ov.open_groups).toBeGreaterThanOrEqual(5)
    expect(ov.hourly.reduce((a: number, b: number) => a + b, 0)).toBeGreaterThanOrEqual(97)
  })
})

