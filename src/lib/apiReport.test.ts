import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
const report = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))
vi.mock('./selfMonitor', () => ({ reportError: report }))
import { api } from './api'

beforeEach(() => { rpc.mockReset(); report.mockReset() })

describe('real faults are reported to our own Monitor, ordinary refusals are not', () => {
  it('reports an unexpected database error, with the function name', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'relation "core.x" does not exist' } })
    await expect(api.myOrgs()).rejects.toThrow('Something went wrong. Please try again.')
    expect(report).toHaveBeenCalledOnce()
    expect((report.mock.calls[0][0] as Error).message).toContain('my_organizations: relation')
    expect(report.mock.calls[0][1]).toEqual({ source: 'rpc', fn: 'my_organizations' })
  })
  it('does not report known rules such as a taken name or missing permission', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'slug_taken' } })
    await expect(api.createOrg('a', 'b')).rejects.toThrow(/already taken/)
    rpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } })
    await expect(api.projects('o')).rejects.toThrow(/permission/)
    expect(report).not.toHaveBeenCalled()
  })
  it('does not report successes', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await api.myOrgs()
    expect(report).not.toHaveBeenCalled()
  })
})
