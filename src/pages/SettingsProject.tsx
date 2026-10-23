import { useState } from 'react'
import { api } from '../lib/api'
import { canManageStructure } from '../lib/perms'
import { isValidName, isValidSlug, slugify } from '../lib/slug'
import { useWs } from '../lib/ws'
import { TypeToConfirm } from '../components/TypeToConfirm'

export function SettingsProject() {
  const ws = useWs()
  const { org, project } = ws
  const can = canManageStructure(org.role)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [edited, setEdited] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState('')
  if (!project) return null

  async function run(fn: () => Promise<unknown>, ok: string) {
    if (busy) return
    setBusy(true); setMsg(null)
    try { await fn(); setMsg({ kind: 'ok', text: ok }); await ws.refreshProjects(project!.id) }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) }
    finally { setBusy(false) }
  }
  async function addEnv(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidName(name) || !isValidSlug(slug)) return setMsg({ kind: 'err', text: 'Enter a name and a short name of 2 to 40 lowercase letters, numbers or dashes.' })
    await run(async () => { await api.createEnv(project!.id, name.trim(), slug); setName(''); setSlug(''); setEdited(false) }, 'Environment added.')
  }
  async function deleteProject() {
    if (busy) return
    setBusy(true); setMsg(null)
    try { await api.deleteProject(project!.id); window.location.hash = '#/'; await ws.refreshProjects() }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) }
    finally { setBusy(false) }
  }

  return (
    <div className="stack">
      {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'} style={{ margin: 0 }}>{msg.text}</div>}
      <section className="card">
        <div className="pad"><h2>Environments</h2></div>
        <div className="tablewrap">
          <table className="tb" style={{ minWidth: 0 }}>
            <thead><tr><th scope="col">Name</th><th scope="col">Short name</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {project.environments.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td><td className="mono">{e.slug}</td>
                  <td style={{ textAlign: 'right' }}>
                    {can && (pendingDelete === e.id
                      ? <span className="row" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn sm danger" type="button" disabled={busy} onClick={() => { setPendingDelete(''); void run(() => api.deleteEnv(e.id), 'Environment deleted.') }}>Confirm delete</button>
                          <button className="btn sm" type="button" onClick={() => setPendingDelete('')}>Cancel</button>
                        </span>
                      : <button className="btn sm" type="button" onClick={() => setPendingDelete(e.id)}>Delete</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can ? (
          <form className="row wrap pad" onSubmit={addEnv}>
            <div><label htmlFor="en">New environment</label><input id="en" className="in" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); if (!edited) setSlug(slugify(e.target.value)) }} /></div>
            <div><label htmlFor="es">Short name</label><input id="es" className="in mono" value={slug} onChange={(e) => { setEdited(true); setSlug(e.target.value.toLowerCase()) }} /></div>
            <div style={{ alignSelf: 'flex-end' }}><button className="btn pri" type="submit" disabled={busy}>Add environment</button></div>
          </form>
        ) : <p className="mu pad" style={{ margin: 0 }}>Only owners and admins can change environments.</p>}
      </section>
      {can && (
        <section className="card padded">
          <h2>Delete project</h2>
          <p className="mu">Deletes this project, its environments and everything stored under them. This cannot be undone.</p>
          <TypeToConfirm word={project.slug} action="Delete project" busy={busy} onConfirm={() => void deleteProject()} />
        </section>
      )}
    </div>
  )
}
