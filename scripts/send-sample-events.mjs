// Fills a Codex project with realistic sample events so you can try Errors, Overview and error grouping.
// Usage (Node 18 or newer):
//   PowerShell:  $env:CODEX_INGEST_URL='https://<ref>.supabase.co/functions/v1/ingest'; $env:CODEX_KEY='cdx_...'; node scripts/send-sample-events.mjs
//   Bash:        CODEX_INGEST_URL=... CODEX_KEY=cdx_... node scripts/send-sample-events.mjs
// Only use a key for a project you do not mind filling with sample data. Every event carries the attribute sample=true.
import { randomUUID } from 'node:crypto'

const url = process.env.CODEX_INGEST_URL
const key = process.env.CODEX_KEY
if (!url || !key) { console.error('Set CODEX_INGEST_URL and CODEX_KEY first.'); process.exit(2) }

const causes = [
  { count: 40, type: 'TypeError', msg: (i) => `Cannot read properties of undefined (reading 'id') for order ${1000 + i}`, frame: (i) => `at confirmOrder (/srv/app/src/checkout.ts:${88 + (i % 3)}:21)` },
  { count: 12, type: 'PaymentVerifyError', msg: (i) => `signature mismatch for reference T${70000 + i}`, frame: () => 'at verifyWebhook (/srv/app/src/webhooks/paystack.ts:41:11)' },
  { count: 8, type: 'TimeoutError', msg: (i) => `database query exceeded 5000ms (attempt ${1 + (i % 3)})`, frame: () => 'at runQuery (/srv/app/src/db.ts:17:9)' },
  { count: 5, type: 'ValidationError', msg: () => 'email is required', frame: () => 'at validateSignup (/srv/app/src/signup.ts:23:13)' },
  { count: 2, type: 'RangeError', msg: () => 'Maximum call stack size exceeded', frame: () => 'at flatten (/srv/app/src/utils/tree.ts:9:5)' },
]
const now = Date.now()
const at = () => new Date(now - Math.floor(Math.random() * 23 * 3600 * 1000)).toISOString()
const events = []
for (const c of causes) {
  for (let i = 0; i < c.count; i++) {
    events.push({
      event_id: randomUUID(), type: 'error', severity: 'error', occurred_at: at(),
      error: { type: c.type, message: c.msg(i), stack: `${c.type}: ${c.msg(i)}\n    ${c.frame(i)}` },
      attributes: { sample: true, route: 'POST /api/checkout', ...(i % 7 === 0 ? { password: 'hunter2', note: 'Bearer abcdefghij0123456789' } : {}) },
      sdk: { name: 'sample-script', version: '1', language: 'javascript' },
    })
  }
}
for (let i = 0; i < 30; i++) {
  events.push({ event_id: randomUUID(), type: 'custom', name: i % 2 ? 'signup' : 'checkout_completed', severity: 'info', occurred_at: at(), attributes: { sample: true, plan: i % 3 ? 'free' : 'pro', currency: i % 2 ? 'NGN' : 'USD' } })
}

let accepted = 0, duplicates = 0, rejected = 0
for (let i = 0; i < events.length; i += 50) {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ events: events.slice(i, i + 50) }) })
  const text = await res.text()
  if (!res.ok) { console.error(`Batch ${i / 50 + 1} failed: ${res.status} ${text}`); process.exit(1) }
  const r = JSON.parse(text)
  accepted += r.accepted; duplicates += r.duplicates; rejected += r.rejected.length
}
console.log(`Sent ${events.length} sample events: accepted ${accepted}, duplicates ${duplicates}, rejected ${rejected}.`)
console.log('Open Errors in the app. You should see 5 error groups, and the Overview chart should fill in.')
