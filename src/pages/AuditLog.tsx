import { useState } from 'react'
import { api } from '../lib/api'
import { canViewAudit } from '../lib/perms'
import { formatDate } from '../lib/format'
import { useLoad } from '../lib/useLoad'
import { useWs } from '../lib/ws'
import { Pagination } from '../components/Pagination'

const SIZE = 25

export function AuditLog() {
  const { org } = useWs()
  const [page, setPage] = useState(1)
  const allowed = canViewAudit(org.role)
  const { data, error, loading } = useLoad(() => (allowed ? api.audit(org.id, SIZE, (page - 1) * SIZE) : Promise.resolve({ total: 0, rows: [] })), [org.id, page, allowed])
  if (!allowed) return <div className="msg" style={{ margin: 0 }}>Only owners and admins can view the audit log.</div>
  return (
    <section className="card">
      {error && <div className="msg err" role="alert" style={{ margin: 16 }}>{error}</div>}
      <div className="tablewrap">
        <table className="tb" style={{ minWidth: 560 }}>
          <thead><tr><th scope="col">Time</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Target</th></tr></thead>
          <tbody>
            {loading && !data && <tr><td colSpan={4}><div className="skel" /></td></tr>}
            {data && data.rows.length === 0 && <tr><td colSpan={4} className="empty">Nothing recorded yet.</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.id}><td className="mu">{formatDate(r.at)}</td><td>{r.actor_email ?? 'Unknown'}</td><td className="mono">{r.action}</td><td className="mono">{r.target ?? ''}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pagination total={data.total} page={page} size={SIZE} onPage={setPage} />}
    </section>
  )
}
