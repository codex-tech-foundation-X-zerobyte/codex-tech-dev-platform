import { useState } from 'react'
import { api } from '../lib/api'
import { assignableRoles, canChangeMember, canManageMembers, canRemoveMember, ROLE_HELP, ROLE_LABEL, ROLES, type OrgRole } from '../lib/perms'
import { formatDate } from '../lib/format'
import { useLoad } from '../lib/useLoad'
import { useWs } from '../lib/ws'

export function Members() {
  const ws = useWs()
  const { org, userId } = ws
  const { data, error, loading, reload } = useLoad(() => api.members(org.id), [org.id])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('viewer')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const addable = assignableRoles(org.role)

  async function run(fn: () => Promise<unknown>, ok: string, after?: () => void) {
    if (busy) return
    setBusy(true); setMsg(null)
    try { await fn(); setMsg({ kind: 'ok', text: ok }); reload(); after?.() }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) }
    finally { setBusy(false) }
  }
  async function leave() {
    if (busy) return
    setBusy(true); setMsg(null)
    try { await api.removeMember(org.id, userId); window.location.hash = '#/'; await ws.refreshOrgs() }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) }
    finally { setBusy(false) }
  }

  return (
    <div className="stack">
      {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'} style={{ margin: 0 }}>{msg.text}</div>}
      {error && <div className="msg err" role="alert" style={{ margin: 0 }}>{error}</div>}
      <section className="card">
        <div className="pad"><h2>Members</h2></div>
        <div className="tablewrap">
          <table className="tb" style={{ minWidth: 560 }}>
            <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {loading && !data && <tr><td colSpan={4}><div className="skel" /></td></tr>}
              {data?.map((m) => {
                const self = m.user_id === userId
                return (
                  <tr key={m.user_id}>
                    <td>{m.email}{self && <span className="mu"> (you)</span>}</td>
                    <td>
                      {canChangeMember(org.role, m.role, self) ? (
                        <>
                          <label className="sr-only" htmlFor={`r-${m.user_id}`}>Role for {m.email}</label>
                          <select id={`r-${m.user_id}`} className="in sm" value={m.role} disabled={busy} onChange={(e) => void run(() => api.setRole(org.id, m.user_id, e.target.value as OrgRole), 'Role updated.')}>
                            {addable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        </>
                      ) : <span className="bd">{ROLE_LABEL[m.role]}</span>}
                    </td>
                    <td className="mu">{formatDate(m.created_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {self
                        ? <button className="btn sm" type="button" disabled={busy} onClick={() => void leave()}>Leave</button>
                        : canRemoveMember(org.role, m.role, false) && <button className="btn sm danger" type="button" disabled={busy} onClick={() => void run(() => api.removeMember(org.id, m.user_id), 'Member removed.')}>Remove</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {canManageMembers(org.role) ? (
          <form className="row wrap pad" onSubmit={(e) => { e.preventDefault(); void run(() => api.addMember(org.id, email.trim(), role), 'Member added.', () => setEmail('')) }}>
            <div><label htmlFor="ae">Add by email</label><input id="ae" className="in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Existing Codex account" required /></div>
            <div><label htmlFor="ar">Role</label><select id="ar" className="in" value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>{addable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
            <div style={{ alignSelf: 'flex-end' }}><button className="btn pri" type="submit" disabled={busy}>Add member</button></div>
          </form>
        ) : <p className="mu pad" style={{ margin: 0 }}>Only owners and admins can add or change members.</p>}
        <p className="mu pad" style={{ margin: 0 }}>The person needs a Codex account first. Email invitations come later.</p>
      </section>
      <section className="card padded">
        <h2>Roles</h2>
        <table className="tb" style={{ minWidth: 0 }}>
          <tbody>{ROLES.map((r) => <tr key={r}><th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--text)' }}>{ROLE_LABEL[r]}</th><td className="mu">{ROLE_HELP[r]}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  )
}
