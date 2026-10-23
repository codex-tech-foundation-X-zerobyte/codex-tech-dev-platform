// Lets this app report its own errors to its own Codex Monitor project. Off unless VITE_SELF_MONITOR_KEY is set.
//
// The key is compiled into the browser bundle, so it is visible to anyone who opens the site. Use a DEDICATED project for
// this, give it a low monthly cap, and revoke the key if it is abused. A leaked key can only add events to that one
// environment; it cannot read anything. Never reuse a customer's or another project's key here.
export type Stats = { enabled: boolean; sent: number; throttled: number; deduped: number; failed: number; last: string }
type Attr = string | number | boolean
type Cfg = { endpoint: string; key: string }

const MAX_PER_MINUTE = 10
const DEDUPE_MS = 60_000
const IGNORED = [/^ResizeObserver loop/i, /^Script error\.?$/i]

let cfg: Cfg | null = null
let windowStart = 0
let inWindow = 0
const recent = new Map<string, number>()
const stats: Stats = { enabled: false, sent: 0, throttled: 0, deduped: 0, failed: 0, last: 'Nothing sent yet.' }
let installed = false
// React (in development) also fires a window error for crashes its error boundary already reports. Marking them avoids a duplicate.
const handled = new WeakSet<object>()
export function markHandled(err: unknown) { if (typeof err === 'object' && err !== null) handled.add(err) }

export const isSelfMonitorOn = () => cfg !== null
export const getStats = (): Stats => ({ ...stats, enabled: cfg !== null })
export const configuredKeyPrefix = () => (cfg ? cfg.key.slice(0, 12) : '')
export const configuredEndpoint = () => (cfg ? cfg.endpoint : '')
export const configuredHost = () => { try { return cfg ? new URL(cfg.endpoint).host : '' } catch { return '' } }

export function initSelfMonitor(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): boolean {
  const key = (env.VITE_SELF_MONITOR_KEY ?? '').trim()
  const base = (env.VITE_SELF_MONITOR_URL ?? env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  if (!/^cdx_[0-9a-f]{64}$/.test(key) || !base) { cfg = null; return false }
  cfg = { endpoint: env.VITE_SELF_MONITOR_URL ? base : `${base}/functions/v1/ingest`, key }
  if (!installed && typeof window !== 'undefined') {
    installed = true
    window.addEventListener('error', (e) => {
      const err: unknown = e.error ?? new Error(e.message || 'Unknown error')
      // Wait one tick so an error boundary that catches this same error can claim it first.
      setTimeout(() => { if (!(typeof err === 'object' && err !== null && handled.has(err))) reportError(err, { source: 'window.onerror' }) }, 0)
    })
    window.addEventListener('unhandledrejection', (e) => reportError((e as PromiseRejectionEvent).reason ?? new Error('Unhandled promise rejection'), { source: 'unhandledrejection' }))
  }
  return true
}

export function resetSelfMonitorForTests() { cfg = null; windowStart = 0; inWindow = 0; recent.clear(); Object.assign(stats, { sent: 0, throttled: 0, deduped: 0, failed: 0, last: 'Nothing sent yet.' }) }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

function route(): string {
  const h = typeof window === 'undefined' ? '' : window.location.hash.slice(1).split('?')[0]
  // Short ids in paths are fine; query strings are dropped so no token in a URL is ever sent.
  return clip(h || '/', 200)
}

// Fire and forget: reporting must never throw, never block the page, and never report its own failures.
export function reportError(err: unknown, attrs: Record<string, Attr> = {}): void {
  try {
    if (!cfg) return
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error value thrown')
    if (IGNORED.some((r) => r.test(e.message))) return
    const now = Date.now()
    const sig = `${e.name}|${e.message}|${(e.stack ?? '').split('\n')[1] ?? ''}`
    const seen = recent.get(sig)
    if (seen !== undefined && now - seen < DEDUPE_MS) { stats.deduped++; return }
    if (now - windowStart > 60_000) { windowStart = now; inWindow = 0 }
    if (inWindow >= MAX_PER_MINUTE) { stats.throttled++; return }
    inWindow++
    recent.set(sig, now)
    if (recent.size > 100) recent.delete(recent.keys().next().value as string)

    const attributes: Record<string, Attr> = { app: 'codex-platform', route: route(), ...attrs }
    const body = JSON.stringify({ events: [{
      event_id: crypto.randomUUID(), type: 'error', severity: 'error', occurred_at: new Date(now).toISOString(),
      error: { type: clip(e.name || 'Error', 200), message: clip(e.message || 'Error', 1900), ...(e.stack ? { stack: clip(e.stack, 15000) } : {}) },
      attributes, sdk: { name: 'codex-platform-self', version: '0.1', language: 'typescript' },
    }] })
    void fetch(cfg.endpoint, { method: 'POST', mode: 'cors', keepalive: true, headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' }, body })
      .then(async (res) => {
        if (res.ok) { stats.sent++; stats.last = `Accepted (${res.status}).` }
        else { stats.failed++; stats.last = `Refused with status ${res.status}${res.status === 401 ? ': the key is wrong or revoked' : res.status === 429 ? ': a limit was reached' : ''}.` }
      })
      .catch(() => { stats.failed++; stats.last = `The request was blocked before it reached Codex. This site is ${typeof location === 'undefined' ? 'unknown' : location.origin}. See the checklist below.` })
  } catch { /* never let reporting break the app */ }
}
