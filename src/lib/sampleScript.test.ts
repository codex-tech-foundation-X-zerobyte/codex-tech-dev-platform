// Runs scripts/send-sample-events.mjs against a local server and checks what it sends with the real validator.
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { validateBatch } from '../../supabase/functions/ingest/validate.ts'

const run = promisify(execFile)
const KEY = 'cdx_' + 'ef'.repeat(32)

describe('sample data script', () => {
  it('needs its settings and says so', async () => {
    await expect(run(process.execPath, ['scripts/send-sample-events.mjs'], { env: { PATH: process.env.PATH } })).rejects.toMatchObject({ code: 2 })
  })
  it('sends 97 events the API accepts: 5 error groups, 30 custom events, secrets redacted', async () => {
    const bodies: unknown[] = []
    const auth: string[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', async () => {
        auth.push(String(req.headers.authorization))
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        bodies.push(parsed)
        const b = await validateBatch(parsed)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ accepted: b.events.length, duplicates: 0, rejected: b.rejected }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/functions/v1/ingest`
    try {
      const { stdout } = await run(process.execPath, ['scripts/send-sample-events.mjs'], { env: { PATH: process.env.PATH, CODEX_INGEST_URL: url, CODEX_KEY: KEY } })
      expect(stdout).toContain('accepted 97, duplicates 0, rejected 0')
      expect(auth.every((a) => a === `Bearer ${KEY}`)).toBe(true)
      const all = (bodies as { events: unknown[] }[]).flatMap((b) => b.events)
      const validated = await validateBatch(all.slice(0, 100))
      expect(all).toHaveLength(97)
      expect(validated.rejected).toEqual([])
      const prints = new Set(validated.events.filter((e) => e.type === 'error').map((e) => e.fingerprint))
      expect(prints.size).toBe(5)
      expect(validated.events.filter((e) => e.type === 'custom')).toHaveLength(30)
      const text = JSON.stringify(validated.events)
      expect(text).not.toContain('hunter2')
      expect(text).not.toContain('abcdefghij0123456789')
    } finally { await new Promise<void>((r) => { server.close(() => r()) }) }
  })
})
