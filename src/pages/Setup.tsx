import { useEffect, useState } from 'react'
import { api, type IngestKey, type NewKey } from '../lib/api'
import { formatDate } from '../lib/format'
import { canManageMonitor } from '../lib/perms'
import { maskedKey } from '../lib/status'
import { useLoad } from '../lib/useLoad'
import { useWs } from '../lib/ws'
import { CapabilityBadge } from '../components/Status'
import { SnippetTabs } from '../components/SnippetTabs'

const BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''

export function Setup() {
  const { org, project } = useWs()
  const can = canManageMonitor(org.role)
  const ov = useLoad(() => (project ? api.overview(project.id) : Promise.resolve(null)), [project?.id])
  const keys = useLoad<IngestKey[]>(() => (project && can ? api.keys(project.id) : Promise.resolve([])), [project?.id, can])
  const [envId, setEnvId] = useState('')
  const [name, setName] = useState('')
  const [created, setCreated] = useState<NewKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [pendingRevoke, setPendingRevoke] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const state = ov.data?.capability.state
  const reloadOverview = ov.reload

  // Poll until the first real event arrives, so Connected appears without a manual refresh.
  useEffect(() => {
    if (state === 'connected') return
    const t = setInterval(() => { reloadOverview() }, 5000)
    return () => clearInterval(t)
  }, [state, reloadOverview])

  if (!project) return null
  const endpoint = `${BASE}/functions/v1/ingest`
  const keyText = created?.key ?? 'YOUR_INGESTION_KEY'

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      const k = await api.createKey(envId || project!.environments[0].id, name.trim())
      setCreated(k); setName(''); setCopied(false); keys.reload(); ov.reload()
    } catch (err) { setMsg({ kind: 'err', text: (err as Error).message }) } finally { setBusy(false) }
  }
  async function revoke(id: string) {
    if (busy) return
    setBusy(true); setMsg(null); setPendingRevoke('')
    try { await api.revokeKey(id); setMsg({ kind: 'ok', text: 'Key revoked. It stops working immediately.' }); keys.reload(); ov.reload() }
    catch (err) { setMsg({ kind: 'err', text: (err as Error).message }) } finally { setBusy(false) }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <>
      <h1>Connect your app</h1>
      <p className="mu h-sub">Codex Monitor for {project.name}</p>
      {msg && <div className={`msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
      <section className="card padded" style={{ marginBottom: 16 }}>
        <div className="row between wrap">
          <h2 style={{ margin: 0 }}>Status</h2>
          {state ? <CapabilityBadge state={state} /> : <span className="bd">Checking</span>}
        </div>
        <p className="mu" style={{ margin: '8px 0 0' }} aria-live="polite">
          {state === 'connected' ? 'Events are arriving.' : (ov.data?.capability.reason ?? 'Checking...')} It shows Connected only after a real event arrives from your app.
        </p>
      </section>

      {!can ? <div className="msg">Only owners, admins and developers can manage ingestion keys.</div> : (
        <>
          <section className="card padded" style={{ marginBottom: 16 }}>
            <h2>1. Create an ingestion key</h2>
            <p className="mu">Each key belongs to one environment. Keep it on your server and never put it in browser code.</p>
            <form className="row wrap" onSubmit={create}>
              <div><label htmlFor="ke">Environment</label>
                <select id="ke" className="in" value={envId || project.environments[0]?.id} onChange={(e) => setEnvId(e.target.value)}>
                  {project.environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select></div>
              <div><label htmlFor="kn">Key name</label><input id="kn" className="in" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Production server" required /></div>
              <div style={{ alignSelf: 'flex-end' }}><button className="btn pri" type="submit" disabled={busy}>Create key</button></div>
            </form>
            {created && (
              <div className="msg ok" role="status" style={{ marginTop: 16 }}>
                <strong>Copy your key now. It is shown only once.</strong>
                <div className="code" style={{ margin: '8px 0' }}>{created.key}</div>
                <button className="btn sm" type="button" onClick={() => void copy(created.key)}>{copied ? 'Copied' : 'Copy key'}</button>
              </div>
            )}
          </section>

          <section className="card padded" style={{ marginBottom: 16 }}>
            <h2>2. Send a test event</h2>
            <p className="mu">Pick the shell or language you use. {created ? 'Your new key is already filled in.' : 'Replace YOUR_INGESTION_KEY with your key.'} The status above changes to Connected when the event arrives.</p>
            <SnippetTabs endpoint={endpoint} keyText={keyText} />
            <p className="mu" style={{ margin: '12px 0 0' }}>Event times must be within the last 7 days. Passwords, tokens, keys and card numbers are removed before storage.</p>
          </section>

          <section className="card">
            <div className="pad"><h2>Your keys</h2></div>
            <div className="tablewrap">
              <table className="tb" style={{ minWidth: 640 }}>
                <thead><tr><th scope="col">Name</th><th scope="col">Key</th><th scope="col">Environment</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {keys.loading && !keys.data && <tr><td colSpan={7}><div className="skel" /></td></tr>}
                  {keys.data && keys.data.length === 0 && <tr><td colSpan={7} className="empty">No keys yet.</td></tr>}
                  {keys.data?.map((k) => (
                    <tr key={k.id}>
                      <td>{k.name}</td><td className="mono">{maskedKey(k.prefix)}</td><td>{k.environment}</td>
                      <td className="mu">{formatDate(k.created_at)}</td><td className="mu">{k.last_used_at ? formatDate(k.last_used_at) : 'Never'}</td>
                      <td>{k.revoked_at ? <span className="bd">Revoked</span> : <span className="bd ok">Active</span>}</td>
                      <td style={{ textAlign: 'right' }}>
                        {!k.revoked_at && (pendingRevoke === k.id
                          ? <span className="row" style={{ justifyContent: 'flex-end' }}>
                              <button className="btn sm danger" type="button" disabled={busy} onClick={() => void revoke(k.id)}>Confirm revoke</button>
                              <button className="btn sm" type="button" onClick={() => setPendingRevoke('')}>Cancel</button>
                            </span>
                          : <button className="btn sm" type="button" onClick={() => setPendingRevoke(k.id)}>Revoke</button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {keys.error && <div className="msg err pad" role="alert">{keys.error}</div>}
          </section>
        </>
      )}
    </>
  )
}
