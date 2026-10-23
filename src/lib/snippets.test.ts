// Every example on the Setup page is executed against a local server and its request body is run through the real
// ingestion validator, so a copy-paste example can never drift out of step with the API.
import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateBatch } from '../../supabase/functions/ingest/validate.ts'
import { buildSnippet, defaultKind, SNIPPETS, type SnippetKind } from './snippets'

const run = promisify(execFile)
const KEY = 'cdx_' + 'ab'.repeat(32)
type Hit = { headers: IncomingHttpHeaders; body: string; method?: string }
let hits: Hit[] = []
let endpoint = ''
let close: () => Promise<void>

beforeAll(async () => {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      hits.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8'), method: req.method })
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"accepted":1,"duplicates":0,"rejected":[]}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/functions/v1/ingest`
  close = () => new Promise((r) => { server.close(() => r()) })
})
afterAll(() => close())

const input = () => ({ endpoint, key: KEY, eventId: crypto.randomUUID(), at: new Date().toISOString() })
const tmp = mkdtempSync(join(tmpdir(), 'codex-snip-'))

async function expectAccepted(h: Hit) {
  expect(h.method).toBe('POST')
  expect(h.headers.authorization).toBe(`Bearer ${KEY}`)
  expect(h.headers['content-type']).toContain('application/json')
  const batch = await validateBatch(JSON.parse(h.body))
  expect(batch.rejected).toEqual([])
  expect(batch.events).toHaveLength(1)
  expect(batch.events[0].type).toBe('error')
}
const last = () => hits[hits.length - 1]
const hasPython = spawnSync('python3', ['--version']).status === 0

describe('every example contains what it needs', () => {
  for (const s of SNIPPETS) {
    it(`${s.label} has the endpoint, the key and a bearer header`, () => {
      const t = buildSnippet(s.kind, input())
      expect(t).toContain(endpoint)
      expect(t).toContain(KEY)
      expect(t).toMatch(/Bearer/)
      expect(t).toMatch(/application\/json/)
    })
  }
  it('lists PowerShell, Command Prompt, Bash, Node.js, TypeScript and Python', () => {
    expect(SNIPPETS.map((s) => s.label)).toEqual(['PowerShell', 'Command Prompt', 'Bash', 'Node.js', 'TypeScript', 'Python'])
  })
  it('defaults to PowerShell on Windows and Bash elsewhere', () => {
    expect(defaultKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('powershell')
    expect(defaultKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('bash')
    expect(defaultKind('Mozilla/5.0 (X11; Linux x86_64)')).toBe('bash')
  })
})

describe('examples really send an event the API accepts', () => {
  it('Bash', async () => {
    hits = []
    await run('sh', ['-c', buildSnippet('bash', input())])
    await expectAccepted(last())
  })
  it('Command Prompt (same quoting rules for curl, run here through curl)', async () => {
    hits = []
    const t = buildSnippet('cmd', input())
    expect(t.startsWith('curl.exe ')).toBe(true)
    expect(t.split('\n')).toHaveLength(1)
    await run('sh', ['-c', t.replace(/^curl\.exe/, 'curl')])
    await expectAccepted(last())
  })
  it('Node.js', async () => {
    hits = []
    const f = join(tmp, 'test-event.mjs')
    writeFileSync(f, buildSnippet('node', input()))
    const { stdout } = await run(process.execPath, [f])
    expect(stdout).toMatch(/^200 /)
    await expectAccepted(last())
  })
  it('TypeScript', async () => {
    hits = []
    const t = buildSnippet('typescript', input())
    const out = ts.transpileModule(t, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true })
    expect(out.diagnostics ?? []).toEqual([])
    const f = join(tmp, 'codex.mjs')
    writeFileSync(f, out.outputText)
    const { stdout } = await run(process.execPath, [f])
    expect(stdout).toContain('accepted: 1')
    await expectAccepted(last())
  })
  it.skipIf(!hasPython)('Python', async () => {
    hits = []
    const f = join(tmp, 'test_event.py')
    writeFileSync(f, buildSnippet('python', input()))
    const { stdout } = await run('python3', [f])
    expect(stdout).toMatch(/^200 /)
    await expectAccepted(last())
  })
  it('PowerShell builds a valid body (checked structurally, since PowerShell cannot run here)', async () => {
    const t = buildSnippet('powershell', input())
    const line = t.split('\n').find((l) => l.startsWith('$body'))!
    const parts = [...line.matchAll(/'([^']*)'/g)].map((m) => m[1]).filter((x) => x !== 'o')
    expect(parts).toHaveLength(3)
    const uuid = crypto.randomUUID()
    const o = '2026-10-22T06:30:00.1234567Z' // what PowerShell's 'o' format produces
    const body = parts[0] + uuid + parts[1] + o + parts[2]
    const batch = await validateBatch(JSON.parse(body), Date.parse('2026-10-22T06:31:00Z'))
    expect(batch.rejected).toEqual([])
    expect(batch.events[0].event_id).toBe(uuid)
    expect(t).toContain('Invoke-RestMethod -Method Post')
    expect(t).toContain(`-Headers @{ Authorization = 'Bearer ${KEY}' }`)
    expect(t).toContain("ToString('o')")
    expect(t).toContain('Tls12')
    expect(t).not.toMatch(/uuidgen|\$\(date/)
  })
})

describe('shell safety', () => {
  it('bash and cmd examples never need uuidgen or date, which are missing on Windows', () => {
    for (const k of ['bash', 'cmd'] as SnippetKind[]) expect(buildSnippet(k, input())).not.toMatch(/uuidgen|\$\(date|\/proc\//)
  })
  it('a fresh event id changes the example, so a second run is not a duplicate', () => {
    const a = buildSnippet('bash', input())
    const b = buildSnippet('bash', input())
    expect(a).not.toBe(b)
  })
})
