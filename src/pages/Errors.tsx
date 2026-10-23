import { useEffect, useState } from 'react'
import { api, type GroupStatus } from '../lib/api'
import { formatDate } from '../lib/format'
import { useLoad } from '../lib/useLoad'
import { useWs } from '../lib/ws'
import { GroupBadge } from '../components/Status'
import { Pagination } from '../components/Pagination'

const SIZE = 25

export function Errors() {
  const { project } = useWs()
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [env, setEnv] = useState('')
  const [status, setStatus] = useState<GroupStatus | ''>('open')
  const [page, setPage] = useState(1)
  useEffect(() => { const t = setTimeout(() => { setTerm(search); setPage(1) }, 300); return () => clearTimeout(t) }, [search])
  const { data, error, loading } = useLoad(
    () => (project ? api.groups(project.id, { env: env || null, status: status || null, search: term, limit: SIZE, offset: (page - 1) * SIZE }) : Promise.resolve(null)),
    [project?.id, env, status, term, page],
  )
  if (!project) return null
  const filtered = Boolean(env || term || status !== 'open')
  return (
    <>
      <h1>Errors</h1>
      <p className="mu h-sub">Grouped by cause</p>
      <div className="filters">
        <div><label htmlFor="q">Search</label><input id="q" className="in" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search errors" /></div>
        <div><label htmlFor="ev">Environment</label>
          <select id="ev" className="in" value={env} onChange={(e) => { setEnv(e.target.value); setPage(1) }}>
            <option value="">All environments</option>
            {project.environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select></div>
        <div><label htmlFor="st">Status</label>
          <select id="st" className="in" value={status} onChange={(e) => { setStatus(e.target.value as GroupStatus | ''); setPage(1) }}>
            <option value="open">Open</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option><option value="">All</option>
          </select></div>
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}
      <section className="card">
        <div className="tablewrap">
          <table className="tb" style={{ minWidth: 640 }}>
            <thead><tr><th scope="col">Error</th><th scope="col">Environment</th><th scope="col">Events</th><th scope="col">Last seen</th><th scope="col">First seen</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {loading && !data && <tr><td colSpan={6}><div className="skel" /></td></tr>}
              {data && data.rows.length === 0 && (
                <tr><td colSpan={6} className="empty">
                  {filtered ? 'No errors match these filters.' : <>No open errors. If your app is not sending events yet, <a href="#/setup">connect it</a>.</>}
                </td></tr>
              )}
              {data?.rows.map((g) => (
                <tr key={g.id}>
                  <td><a href={`#/errors/${g.id}`}>{g.title}</a></td>
                  <td>{g.environment}</td>
                  <td>{g.event_count.toLocaleString('en-GB')}</td>
                  <td className="mu">{formatDate(g.last_seen)}</td>
                  <td className="mu">{formatDate(g.first_seen)}</td>
                  <td><GroupBadge status={g.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <Pagination total={data.total} page={page} size={SIZE} onPage={setPage} />}
      </section>
    </>
  )
}
