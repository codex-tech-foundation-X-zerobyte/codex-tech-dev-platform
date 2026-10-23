// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('./lib/supabase', () => ({ configured: true, supabase: { auth } }))
const api = vi.hoisted(() => ({
  myOrgs: vi.fn(), createOrg: vi.fn(), deleteOrg: vi.fn(), projects: vi.fn(), createProject: vi.fn(), deleteProject: vi.fn(),
  createEnv: vi.fn(), deleteEnv: vi.fn(), members: vi.fn(), addMember: vi.fn(), setRole: vi.fn(), removeMember: vi.fn(), audit: vi.fn(),
  overview: vi.fn(), groups: vi.fn(), group: vi.fn(), setGroupStatus: vi.fn(), keys: vi.fn(), createKey: vi.fn(), revokeKey: vi.fn(),
}))
vi.mock('./lib/api', async (orig) => ({ ...(await orig<typeof import('./lib/api')>()), api }))

import App from './App'

const session = { user: { id: 'u1', email: 'ada@acme.com' } }
const project = {
  id: 'p1', name: 'Web', slug: 'web', created_at: '2026-10-21T10:00:00Z',
  environments: [{ id: 'e1', name: 'Production', slug: 'production' }, { id: 'e2', name: 'Development', slug: 'development' }],
}
const org = (role: string) => ({ id: 'o1', name: 'Acme', slug: 'acme', role })

beforeEach(() => { window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia; localStorage.clear(); window.location.hash = '#/'; vi.clearAllMocks(); auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe() {} } } }) })
afterEach(cleanup)

describe('signed out', () => {
  it('shows the landing page first, with routes to sign in and create account', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } })
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: /Know what broke/ })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Sign in' })[0].getAttribute('href')).toBe('#/signin')
    expect(screen.getAllByRole('link', { name: /Get started|Create your account/ })[0].getAttribute('href')).toBe('#/signup')
  })
  it('sign up asks the user to confirm by email', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } })
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null })
    window.location.hash = '#/signup'
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('Email'), 'new@acme.com')
    await user.type(screen.getByLabelText('Password'), 'longenough1')
    await user.click(screen.getAllByRole('button', { name: 'Create account' })[1])
    expect(await screen.findByText(/Check your email to confirm/)).toBeTruthy()
    expect(auth.signUp).toHaveBeenCalledOnce()
  })
  it('sign in route shows the sign in form with a way back home', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } })
    window.location.hash = '#/signin'
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('#/')
  })
  it('rejects a short password before calling the server', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } })
    window.location.hash = '#/signup'
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('Email'), 'new@acme.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getAllByRole('button', { name: 'Create account' })[1])
    expect(await screen.findByText(/at least 8 characters/)).toBeTruthy()
    expect(auth.signUp).not.toHaveBeenCalled()
  })
})

describe('signed in', () => {
  beforeEach(() => {
    auth.getSession.mockResolvedValue({ data: { session } })
    api.overview.mockResolvedValue({ capability: { state: 'setup_required', reason: 'Create an ingestion key.', last_success_at: null, active_keys: 0 }, events_24h: 0, open_groups: 0, new_groups_24h: 0, usage_month: 0, monthly_cap: 100000, hourly: [] })
  })

  it('a new user creates an organization with an automatic short name', async () => {
    api.myOrgs.mockResolvedValueOnce([])
    api.createOrg.mockResolvedValue({ id: 'o1' })
    api.myOrgs.mockResolvedValue([org('owner')])
    api.projects.mockResolvedValue([])
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('Organization name'), 'Acme Inc')
    expect((screen.getByLabelText('Short name (used in links)') as HTMLInputElement).value).toBe('acme-inc')
    await user.click(screen.getByRole('button', { name: 'Create organization' }))
    await waitFor(() => expect(api.createOrg).toHaveBeenCalledWith('Acme Inc', 'acme-inc'))
    expect(await screen.findByText('Create a project')).toBeTruthy()
  })

  it('the first-run screen shows who is signed in and offers sign out', async () => {
    api.myOrgs.mockResolvedValue([])
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('ada@acme.com')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(auth.signOut).toHaveBeenCalledOnce()
  })

  it('an organization without projects is asked to create one', async () => {
    api.myOrgs.mockResolvedValue([org('owner')])
    api.projects.mockResolvedValue([])
    api.createProject.mockResolvedValue({ id: 'p1' })
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('Project name'), 'Web')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith('o1', 'Web', 'web'))
  })

  it('invalid short names are stopped before the server', async () => {
    api.myOrgs.mockResolvedValue([])
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('Organization name'), 'X')
    await user.click(screen.getByRole('button', { name: 'Create organization' }))
    expect(await screen.findByText(/2 to 40 lowercase letters/)).toBeTruthy()
    expect(api.createOrg).not.toHaveBeenCalled()
  })

  it('the overview shows the two default environments and honest integration states', async () => {
    api.myOrgs.mockResolvedValue([org('owner')])
    api.projects.mockResolvedValue([project])
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Web' })).toBeTruthy()
    expect(screen.getByText(/Environments: Production, Development/)).toBeTruthy()
    expect(await screen.findByText('Setup required')).toBeTruthy()
    expect(screen.getAllByText('Not configured')).toHaveLength(3)
    expect(screen.queryByText('Connected')).toBeNull()
  })

  it('a viewer sees no audit tab and no management controls', async () => {
    api.myOrgs.mockResolvedValue([org('viewer')])
    api.projects.mockResolvedValue([project])
    api.members.mockResolvedValue([{ user_id: 'u1', email: 'ada@acme.com', role: 'viewer', created_at: '2026-10-21T10:00:00Z' }])
    window.location.hash = '#/settings/members'
    render(<App />)
    expect(await screen.findByText(/Only owners and admins can add or change members/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Audit log' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull()
  })

  it('an owner can add members and delete controls need the typed name', async () => {
    api.myOrgs.mockResolvedValue([org('owner')])
    api.projects.mockResolvedValue([project])
    api.deleteProject.mockResolvedValue({ ok: true })
    window.location.hash = '#/settings/project'
    const user = userEvent.setup()
    render(<App />)
    const del = await screen.findByRole('button', { name: 'Delete project' })
    expect((del as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText(/Type/), 'web')
    expect((del as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a friendly error when loading fails, never the raw one', async () => {
    api.myOrgs.mockRejectedValue(new Error('Something went wrong. Please try again.'))
    render(<App />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
