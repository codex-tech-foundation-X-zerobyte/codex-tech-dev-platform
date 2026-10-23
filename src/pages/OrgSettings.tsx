import { useState } from 'react'
import { api } from '../lib/api'
import { canDeleteOrg } from '../lib/perms'
import { useWs } from '../lib/ws'
import { TypeToConfirm } from '../components/TypeToConfirm'

export function OrgSettings() {
  const ws = useWs()
  const { org } = ws
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function remove() {
    if (busy) return
    setBusy(true); setError('')
    try { await api.deleteOrg(org.id); window.location.hash = '#/'; await ws.refreshOrgs() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <div className="stack">
      <section className="card padded">
        <h2>Organization</h2>
        <table className="tb" style={{ minWidth: 0 }}>
          <tbody>
            <tr><th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--muted)' }}>Name</th><td>{org.name}</td></tr>
            <tr><th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--muted)' }}>Short name</th><td className="mono">{org.slug}</td></tr>
          </tbody>
        </table>
      </section>
      {canDeleteOrg(org.role) ? (
        <section className="card padded">
          <h2>Delete organization</h2>
          <p className="mu">Deletes the organization, all its projects, members and audit history. This cannot be undone.</p>
          {error && <div className="msg err" role="alert">{error}</div>}
          <TypeToConfirm word={org.slug} action="Delete organization" busy={busy} onConfirm={() => void remove()} />
        </section>
      ) : <p className="mu" style={{ margin: 0 }}>Only an owner can delete the organization.</p>}
    </div>
  )
}
