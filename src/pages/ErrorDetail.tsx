import { useState } from 'react'
import { api, type GroupStatus } from '../lib/api'
import { formatDate } from '../lib/format'
import { canManageMonitor } from '../lib/perms'
import { useLoad } from '../lib/useLoad'
import { useWs } from '../lib/ws'
import { GroupBadge } from '../components/Status'

export function ErrorDetail({ id }: { id: string }) {
  const { org } = useWs()
  const { data, error, loading, reload } = useLoad(() => api.group(id), [id])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const can = canManageMonitor(org.role)

  async function setStatus(s: GroupStatus) {
    if (busy) return
    setBusy(true); setMsg('')
    try { await api.setGroupStatus(id, s); reload() } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  if (error) return <><a href="#/errors">Back to errors</a><div className="msg err" role="alert" style={{ marginTop: 12 }}>{error}</div></>
  if (loading && !data) return <div className="skel" />
  if (!data) return null
  const g = data.group
  const latest = data.events[0]
  const attrs = latest ? Object.entries(latest.attributes) : []
  return (
    <>
      <p style={{ margin: '0 0 12px' }}><a href="#/errors">Back to errors</a></p>
      <div className="row between wrap">
        <div><h1 style={{ overflowWrap: 'anywhere' }}>{g.title}</h1></div>
        {can && (
          <div className="row wrap">
            {g.status !== 'ignored' && <button className="btn" type="button" disabled={busy} onClick={() => void setStatus('ignored')}>Ignore</button>}
            {g.status === 'open'
              ? <button className="btn pri" type="button" disabled={busy} onClick={() => void setStatus('resolved')}>Resolve</button>
              : <button className="btn pri" type="button" disabled={busy} onClick={() => void setStatus('open')}>Reopen</button>}
          </div>
        )}
      </div>
      <div className="row wrap" style={{ margin: '12px 0' }}>
        <GroupBadge status={g.status} /><span className="bd">{g.environment}</span><span className="bd">{g.event_count.toLocaleString('en-GB')} events</span>
        <span className="mu">First seen {formatDate(g.first_seen)}. Last seen {formatDate(g.last_seen)}.</span>
      </div>
      {msg && <div className="msg err" role="alert">{msg}</div>}
      <div className="two-col">
        <section className="card padded">
          <h2>Latest stack trace</h2>
          {latest?.error_stack ? <div className="code" tabIndex={0}>{latest.error_stack}</div> : <p className="mu" style={{ margin: 0 }}>No stack trace was sent.</p>}
        </section>
        <section className="card padded">
          <h2>Details</h2>
          <table className="tb" style={{ minWidth: 0 }}>
            <tbody>
              {latest?.trace_id && <tr><th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--muted)' }}>Trace</th><td className="mono">{latest.trace_id}</td></tr>}
              {latest?.sdk_name && <tr><th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--muted)' }}>SDK</th><td className="mono">{latest.sdk_name} {latest.sdk_version ?? ''}</td></tr>}
              {attrs.map(([k, v]) => <tr key={k}><th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--muted)' }}>{k}</th><td className="mono">{String(v)}</td></tr>)}
              {attrs.length === 0 && !latest?.trace_id && <tr><td className="mu">No extra details were sent.</td></tr>}
            </tbody>
          </table>
          <p className="mu" style={{ margin: '12px 0 0' }}>Passwords, tokens, keys and card numbers are removed before storage.</p>
        </section>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="pad"><h2>Recent occurrences</h2></div>
        <div className="tablewrap">
          <table className="tb" style={{ minWidth: 480 }}>
            <thead><tr><th scope="col">Event</th><th scope="col">Time</th><th scope="col">Message</th></tr></thead>
            <tbody>
              {data.events.map((e) => <tr key={e.id}><td className="mono">{e.event_id.slice(0, 8)}</td><td className="mu">{formatDate(e.occurred_at)}</td><td style={{ overflowWrap: 'anywhere' }}>{e.error_message ?? ''}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
