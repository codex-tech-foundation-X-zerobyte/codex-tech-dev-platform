// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { initSelfMonitor, resetSelfMonitorForTests } from '../lib/selfMonitor'
import { Debug } from './Debug'

const KEY = 'cdx_' + 'cd'.repeat(32)
const fetchMock = vi.fn()
beforeEach(() => { resetSelfMonitorForTests(); fetchMock.mockReset(); fetchMock.mockImplementation(() => Promise.resolve(new Response('{"accepted":1}', { status: 200 }))); vi.stubGlobal('fetch', fetchMock); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('self-monitoring test page', () => {
  it('explains how to turn it on when it is off', () => {
    render(<Debug />)
    expect(screen.getByRole('heading', { name: 'Self-monitoring is off' })).toBeTruthy()
    expect(screen.getByText(/VITE_SELF_MONITOR_KEY/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send a handled error' })).toBeNull()
  })
  it('shows where events go, without revealing the whole key', () => {
    initSelfMonitor({ VITE_SELF_MONITOR_KEY: KEY, VITE_SUPABASE_URL: 'https://abc123.supabase.co' })
    const { container } = render(<Debug />)
    expect(screen.getByText('abc123.supabase.co')).toBeTruthy()
    expect(container.textContent).toContain('cdx_cdcdcdcd')
    expect(container.textContent).not.toContain(KEY)
  })
  it('sends a handled error and shows the result', async () => {
    initSelfMonitor({ VITE_SELF_MONITOR_KEY: KEY, VITE_SUPABASE_URL: 'https://abc123.supabase.co' })
    const user = userEvent.setup()
    render(<Debug />)
    await user.click(screen.getByRole('button', { name: 'Send a handled error' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).events[0].error.message).toBe('Codex self-test: handled error')
    await waitFor(() => expect(screen.getByText(/Accepted/)).toBeTruthy(), { timeout: 3000 })
  })
})

describe('when the browser blocks the request', () => {
  it('explains the three usual causes and gives a command to check the function', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    initSelfMonitor({ VITE_SELF_MONITOR_KEY: KEY, VITE_SUPABASE_URL: 'https://abc123.supabase.co' })
    const user = userEvent.setup()
    render(<Debug />)
    await user.click(screen.getByRole('button', { name: 'Send a handled error' }))
    expect(await screen.findByText(/blocked the request/, {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getAllByText(/--no-verify-jwt/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(new RegExp(`CORS_ALLOW_ORIGINS=${window.location.origin}`)).length).toBeGreaterThan(0)
    const cmd = document.querySelector('.code')!.textContent!
    expect(cmd).toContain('Invoke-WebRequest')
    expect(cmd).toContain('https://abc123.supabase.co/functions/v1/ingest')
    expect(cmd).toContain(`Origin = '${window.location.origin}'`)
  })
  it('shows no troubleshooting when everything works', async () => {
    initSelfMonitor({ VITE_SELF_MONITOR_KEY: KEY, VITE_SUPABASE_URL: 'https://abc123.supabase.co' })
    const user = userEvent.setup()
    render(<Debug />)
    await user.click(screen.getByRole('button', { name: 'Send a handled error' }))
    await waitFor(() => expect(screen.getByText(/Accepted/)).toBeTruthy(), { timeout: 3000 })
    expect(screen.queryByText(/blocked the request/)).toBeNull()
  })
})

describe('error boundary', () => {
  it('shows a friendly page and reports the crash', async () => {
    initSelfMonitor({ VITE_SELF_MONITOR_KEY: KEY, VITE_SUPABASE_URL: 'https://abc123.supabase.co' })
    const user = userEvent.setup()
    render(<ErrorBoundary><Debug /></ErrorBoundary>)
    await user.click(screen.getByRole('button', { name: 'Crash this screen' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    const sent = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).events[0])
    expect(sent.some((e) => e.error.message === 'Codex self-test: render error' && e.attributes.source === 'react')).toBe(true)
  })
  it('works even when monitoring is off', async () => {
    const user = userEvent.setup()
    render(<ErrorBoundary><Debug /></ErrorBoundary>)
    expect(screen.queryByRole('button', { name: 'Crash this screen' })).toBeNull()
    expect(user).toBeTruthy()
  })
})
