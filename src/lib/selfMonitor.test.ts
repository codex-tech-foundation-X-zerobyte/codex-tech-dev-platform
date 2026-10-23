// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateBatch } from '../../supabase/functions/ingest/validate.ts'
import { markHandled, configuredHost, configuredKeyPrefix, getStats, initSelfMonitor, isSelfMonitorOn, reportError, resetSelfMonitorForTests } from './selfMonitor'

const KEY = 'cdx_' + 'ab'.repeat(32)
const ENV = { VITE_SELF_MONITOR_KEY: KEY, VITE_SUPABASE_URL: 'https://abc123.supabase.co/' }
const fetchMock = vi.fn()
const flush = () => new Promise((r) => setTimeout(r, 0))
const body = (i = 0) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string)
const ok = () => Promise.resolve(new Response('{"accepted":1,"duplicates":0,"rejected":[]}', { status: 200 }))

beforeEach(() => { resetSelfMonitorForTests(); fetchMock.mockReset(); fetchMock.mockImplementation(ok); vi.stubGlobal('fetch', fetchMock); window.location.hash = '#/errors' })
afterEach(() => { vi.unstubAllGlobals() })

describe('configuration', () => {
  it('is off without a valid key or a URL, and sends nothing', () => {
    expect(initSelfMonitor({})).toBe(false)
    expect(initSelfMonitor({ VITE_SELF_MONITOR_KEY: 'cdx_short', VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBe(false)
    expect(initSelfMonitor({ VITE_SELF_MONITOR_KEY: KEY })).toBe(false)
    reportError(new Error('x'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isSelfMonitorOn()).toBe(false)
  })
  it('derives the ingest address from the Supabase address', () => {
    expect(initSelfMonitor(ENV)).toBe(true)
    expect(configuredHost()).toBe('abc123.supabase.co')
    expect(configuredKeyPrefix()).toBe('cdx_abababab')
    reportError(new Error('boom'))
    expect(fetchMock.mock.calls[0][0]).toBe('https://abc123.supabase.co/functions/v1/ingest')
  })
})

describe('what is sent', () => {
  beforeEach(() => { initSelfMonitor(ENV) })
  it('is a request the real ingestion validator accepts, with the key in the header', async () => {
    reportError(new TypeError('Cannot read properties of undefined'), { source: 'test' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    expect(init.method).toBe('POST')
    const batch = await validateBatch(body())
    expect(batch.rejected).toEqual([])
    expect(batch.events[0].type).toBe('error')
    expect(batch.events[0].fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(batch.events[0].error?.type).toBe('TypeError')
    expect(batch.events[0].attributes).toMatchObject({ app: 'codex-platform', route: '/errors', source: 'test' })
  })
  it('never includes the query string or the signed-in person', () => {
    window.location.hash = '#/errors/abc?token=secret123&email=a@b.com'
    reportError(new Error('x'))
    const text = JSON.stringify(body())
    expect(text).not.toContain('secret123')
    expect(text).not.toContain('a@b.com')
    expect(body().events[0].attributes.route).toBe('/errors/abc')
  })
  it('shortens oversized messages and stacks so they are still accepted', async () => {
    const e = new Error('m'.repeat(5000)); e.stack = 'Error: x\n' + '    at f (a.ts:1:1)\n'.repeat(2000)
    reportError(e)
    const batch = await validateBatch(body())
    expect(batch.rejected).toEqual([])
  })
  it('turns strings and odd values into errors, and ignores browser noise', () => {
    reportError('plain string')
    reportError({ not: 'an error' })
    reportError(new Error('ResizeObserver loop completed with undelivered notifications.'))
    reportError(new Error('Script error.'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(body(0).events[0].error.message).toBe('plain string')
  })
})

describe('it can never hurt the app', () => {
  beforeEach(() => { initSelfMonitor(ENV) })
  it('sends the same error only once a minute', () => {
    const e = new Error('same'); e.stack = 'Error: same\n    at a (x.ts:1:1)'
    reportError(e); reportError(e); reportError(e)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getStats().deduped).toBe(2)
  })
  it('caps a flood at 10 a minute', () => {
    for (let i = 0; i < 25; i++) reportError(new Error(`distinct ${i}`))
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(getStats().throttled).toBe(15)
  })
  it('swallows network failures and explains them', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(() => reportError(new Error('a'))).not.toThrow()
    await flush()
    expect(getStats().failed).toBe(1)
    expect(getStats().last).toMatch(/blocked before it reached Codex/)
    expect(getStats().last).toContain(window.location.origin)
  })
  it('swallows a fetch that throws immediately', () => {
    fetchMock.mockImplementation(() => { throw new Error('sync failure') })
    expect(() => reportError(new Error('b'))).not.toThrow()
  })
  it('explains a refused key and a hit limit', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 401 })))
    reportError(new Error('c')); await flush()
    expect(getStats().last).toMatch(/key is wrong or revoked/)
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 429 })))
    reportError(new Error('d')); await flush()
    expect(getStats().last).toMatch(/limit/)
  })
  it('counts successes', async () => {
    reportError(new Error('e')); await flush()
    expect(getStats().sent).toBe(1)
    expect(getStats().last).toMatch(/Accepted/)
  })
})

describe('global handlers', () => {
  beforeEach(() => { initSelfMonitor(ENV) })
  it('reports uncaught errors', async () => {
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught one'), message: 'uncaught one' }))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(body().events[0].attributes.source).toBe('window.onerror')
    expect(body().events[0].error.message).toBe('uncaught one')
  })
  it('does not report twice an error that an error boundary already handled', async () => {
    const err = new Error('boundary one')
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'boundary one' }))
    markHandled(err)
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('reports unhandled promise rejections', () => {
    const ev = new Event('unhandledrejection') as Event & { reason?: unknown }
    ev.reason = new Error('rejected one')
    window.dispatchEvent(ev)
    expect(body().events[0].attributes.source).toBe('unhandledrejection')
  })
})
