// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })), signOut: vi.fn(),
}))
vi.mock('./lib/supabase', () => ({ configured: true, supabase: { auth } }))
const api = vi.hoisted(() => ({
  myOrgs: vi.fn(), projects: vi.fn(), overview: vi.fn(), groups: vi.fn(), group: vi.fn(), setGroupStatus: vi.fn(), keys: vi.fn(), createKey: vi.fn(), revokeKey: vi.fn(),
}))
vi.mock('./lib/api', async (orig) => ({ ...(await orig<typeof import('./lib/api')>()), api }))
import App from './App'

const session = { user: { id: 'u1', email: 'ada@acme.com' } }
const project = { id: 'p1', name: 'Web', slug: 'web', created_at: '2026-10-21T10:00:00Z', environments: [{ id: 'e1', name: 'Production', slug: 'production' }, { id: 'e2', name: 'Development', slug: 'development' }] }
const org = (role: string) => ({ id: 'o1', name: 'Acme', slug: 'acme', role })
const cap = (state: string, extra = {}) => ({ state, reason: state === 'verifying' ? 'Waiting for the first event.' : null, last_success_at: state === 'connected' ? '2026-10-21T11:58:00Z' : null, active_keys: 1, ...extra })
const overview = (state: string, o: Record<string, unknown> = {}) => ({ capability: cap(state), events_24h: 1240, open_groups: 14, new_groups_24h: 3, usage_month: 62410, monthly_cap: 100000, hourly: Array.from({ length: 24 }, (_, i) => i), ...o })
const group = (o: Record<string, unknown> = {}) => ({ id: 'g1', title: 'TypeError: Cannot read properties of undefined', status: 'open', event_count: 412, first_seen: '2026-10-18T10:00:00Z', last_seen: '2026-10-21T11:58:00Z', environment_id: 'e1', environment: 'Production', ...o })
const event = { id: 9, event_id: '11111111-1111-4111-8111-111111111111', occurred_at: '2026-10-21T11:58:00Z', severity: 'error', error_type: 'TypeError', error_message: 'Cannot read properties of undefined', error_stack: 'TypeError: x\n    at confirmOrder (src/checkout.ts:88:21)', trace_id: 'abc123', attributes: { route: 'POST /api/checkout', password: '[redacted]' }, sdk_name: null, sdk_version: null }

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
  localStorage.clear(); window.location.hash = '#/'; vi.clearAllMocks()
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe() {} } } })
  auth.getSession.mockResolvedValue({ data: { session } })
  api.projects.mockResolvedValue([project])
  api.myOrgs.mockResolvedValue([org('owner')])
  api.overview.mockResolvedValue(overview('connected'))
  api.groups.mockResolvedValue({ total: 1, rows: [group()] })
  api.keys.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('overview', () => {
  it('shows real numbers and the Connected state', async () => {
    render(<App />)
    expect(await screen.findByText('1,240')).toBeTruthy()
    expect(screen.getByText('62,410')).toBeTruthy()
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: /62 percent of the monthly event limit/ })).toBeTruthy()
  })
  it('sends a project that has not received an event to setup, and says why', async () => {
    api.overview.mockResolvedValue(overview('verifying', { events_24h: 0, open_groups: 0, new_groups_24h: 0, hourly: [] }))
    render(<App />)
    expect(await screen.findByText('Verifying')).toBeTruthy()
    expect(screen.getByText(/Waiting for the first event/)).toBeTruthy()
    expect(screen.getByText('No events in the last 24 hours.')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Open setup|Connect your app/ }).length).toBeGreaterThan(0)
  })
})

describe('errors list', () => {
  beforeEach(() => { window.location.hash = '#/errors' })
  it('lists groups with a text status and a link to the detail', async () => {
    render(<App />)
    const link = await screen.findByRole('link', { name: /TypeError: Cannot read/ })
    expect(link.getAttribute('href')).toBe('#/errors/g1')
    expect(screen.getByText('Open', { selector: '.bd' })).toBeTruthy()
    expect(api.groups).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'open', env: null, limit: 25, offset: 0 }))
  })
  it('searches after a short pause and filters by status', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('link', { name: /TypeError/ })
    await user.type(screen.getByLabelText('Search'), 'timeout')
    await waitFor(() => expect(api.groups).toHaveBeenCalledWith('p1', expect.objectContaining({ search: 'timeout', offset: 0 })))
    await user.selectOptions(screen.getByLabelText('Status'), 'resolved')
    await waitFor(() => expect(api.groups).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'resolved' })))
  })
  it('explains an empty list and points to setup', async () => {
    api.groups.mockResolvedValue({ total: 0, rows: [] })
    render(<App />)
    expect(await screen.findByText(/No open errors/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'connect it' }).getAttribute('href')).toBe('#/setup')
  })
  it('shows a friendly message when loading fails', async () => {
    api.groups.mockRejectedValue(new Error('You do not have permission to do that.'))
    render(<App />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/permission/)
  })
})

describe('error detail', () => {
  beforeEach(() => { window.location.hash = '#/errors/g1'; api.group.mockResolvedValue({ group: group(), events: [event] }) })
  it('shows the stack and details, with sensitive values already redacted', async () => {
    render(<App />)
    expect(await screen.findByText(/at confirmOrder/)).toBeTruthy()
    expect(screen.getByText('POST /api/checkout')).toBeTruthy()
    expect(screen.getByText('[redacted]')).toBeTruthy()
    expect(screen.getByText(/removed before storage/)).toBeTruthy()
  })
  it('lets a developer resolve it', async () => {
    api.myOrgs.mockResolvedValue([org('developer')])
    api.setGroupStatus.mockResolvedValue({})
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(api.setGroupStatus).toHaveBeenCalledWith('g1', 'resolved'))
  })
  it('gives a viewer read-only access', async () => {
    api.myOrgs.mockResolvedValue([org('viewer')])
    render(<App />)
    await screen.findByText(/at confirmOrder/)
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ignore' })).toBeNull()
  })
})

describe('setup', () => {
  beforeEach(() => { window.location.hash = '#/setup'; api.overview.mockResolvedValue(overview('verifying', { events_24h: 0 })) })
  it('creates a key, shows the secret once and builds the snippet with it', async () => {
    const secret = 'cdx_' + 'ab'.repeat(32)
    api.createKey.mockResolvedValue({ id: 'k1', name: 'Prod', environment_id: 'e1', prefix: secret.slice(0, 12), key: secret })
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('Key name'), 'Prod')
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(api.createKey).toHaveBeenCalledWith('e1', 'Prod'))
    expect(await screen.findByText(/shown only once/)).toBeTruthy()
    expect(screen.getAllByText(new RegExp(secret)).length).toBeGreaterThan(1)
    const snippets = screen.getAllByText(/\/functions\/v1\/ingest/, { selector: '.code' })
    expect(snippets).toHaveLength(1)
    expect(snippets[0].textContent).toContain(`Bearer ${secret}`)
  })
  it('offers PowerShell, Command Prompt, Bash, Node.js, TypeScript and Python, and remembers the choice', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    const tabs = within(await screen.findByRole('tablist', { name: /shell or language/ })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['PowerShell', 'Command Prompt', 'Bash', 'Node.js', 'TypeScript', 'Python'])
    expect(screen.getByRole('tab', { name: 'Bash' }).getAttribute('aria-selected')).toBe('true')
    await user.click(screen.getByRole('tab', { name: 'PowerShell' }))
    expect(screen.getAllByText(/Invoke-RestMethod/).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('tab', { name: 'TypeScript' }))
    expect(screen.getAllByText(/npx tsx codex\.mts/).length).toBeGreaterThan(0)
    unmount(); cleanup()
    render(<App />)
    expect((await screen.findByRole('tab', { name: 'TypeScript' })).getAttribute('aria-selected')).toBe('true')
  })
  it('gives a fresh event id on request', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('tab', { name: 'Command Prompt' }))
    const before = document.querySelector('#snippet-panel .code')!.textContent
    await user.click(screen.getByRole('button', { name: 'New test event' }))
    expect(document.querySelector('#snippet-panel .code')!.textContent).not.toBe(before)
  })
  it('lists keys masked and never shows a full key', async () => {
    api.keys.mockResolvedValue([{ id: 'k1', name: 'Prod', prefix: 'cdx_a1b2c3d4', environment_id: 'e1', environment: 'Production', created_at: '2026-10-21T10:00:00Z', last_used_at: null, revoked_at: null }])
    render(<App />)
    expect(await screen.findByText('cdx_a1b2c3d4••••••••')).toBeTruthy()
    expect(screen.getByText('Never')).toBeTruthy()
  })
  it('needs a second click to revoke', async () => {
    api.keys.mockResolvedValue([{ id: 'k1', name: 'Prod', prefix: 'cdx_a1b2c3d4', environment_id: 'e1', environment: 'Production', created_at: '2026-10-21T10:00:00Z', last_used_at: null, revoked_at: null }])
    api.revokeKey.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))
    expect(api.revokeKey).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }))
    await waitFor(() => expect(api.revokeKey).toHaveBeenCalledWith('k1'))
  })
  it('keeps keys away from viewers', async () => {
    api.myOrgs.mockResolvedValue([org('viewer')])
    render(<App />)
    expect(await screen.findByText(/Only owners, admins and developers can manage ingestion keys/)).toBeTruthy()
    expect(api.keys).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Create key' })).toBeNull()
  })
  it('keeps checking for the first event until it arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<App />)
    await screen.findByText('Verifying')
    const before = api.overview.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })
    expect(api.overview.mock.calls.length).toBeGreaterThan(before)
    api.overview.mockResolvedValue(overview('connected'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })
    expect(await screen.findByText(/Events are arriving/)).toBeTruthy()
    const calls = api.overview.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(api.overview.mock.calls.length).toBe(calls)
  })
  it('shows the navigation entries for the new pages', async () => {
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    for (const n of ['Overview', 'Errors', 'Setup', 'Settings']) expect(within(nav).getByRole('link', { name: n })).toBeTruthy()
  })
})
