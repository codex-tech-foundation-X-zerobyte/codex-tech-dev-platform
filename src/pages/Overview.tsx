import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import { barHeights, usagePercent } from '../lib/status'
import { useLoad } from '../lib/useLoad'
import { useWs } from '../lib/ws'
import { CapabilityBadge } from '../components/Status'

export function Overview() {
  const { org, project } = useWs()
  const { data, error, loading } = useLoad(() => (project ? api.overview(project.id) : Promise.resolve(null)), [project?.id])
  if (!project) return null
  const cap = data?.capability
  const hours = data?.hourly ?? []
  const pct = data ? usagePercent(data.usage_month, data.monthly_cap) : 0
  return (
    <>
      <h1>{project.name}</h1>
      <p className="mu h-sub">{org.name}. Environments: {project.environments.map((e) => e.name).join(', ')}</p>
      {error && <div className="msg err" role="alert">{error}</div>}
      <div className="four-col">
        <section className="card padded stat"><div className="mu">Events, last 24 hours</div><div className="big">{loading && !data ? '...' : (data?.events_24h ?? 0).toLocaleString('en-GB')}</div></section>
        <section className="card padded stat"><div className="mu">Open error groups</div><div className="big">{loading && !data ? '...' : (data?.open_groups ?? 0).toLocaleString('en-GB')}</div><div className="mu">{data?.new_groups_24h ?? 0} new in the last 24 hours</div></section>
        <section className="card padded stat">
          <div className="mu">Events this month</div>
          <div className="big">{loading && !data ? '...' : (data?.usage_month ?? 0).toLocaleString('en-GB')}</div>
          <div className="meter" role="img" aria-label={`${pct} percent of the monthly event limit used`} style={{ margin: '8px 0 4px' }}><i style={{ width: `${pct}%` }} /></div>
          <div className="mu">{pct}% of {(data?.monthly_cap ?? 0).toLocaleString('en-GB')}</div>
        </section>
        <section className="card padded stat"><div className="mu">Last event</div><div className="big" style={{ fontSize: 18 }}>{cap?.last_success_at ? formatDate(cap.last_success_at) : 'None yet'}</div></section>
      </div>
      <div className="two-col" style={{ marginTop: 16 }}>
        <section className="card padded">
          <h2>Events per hour</h2>
          {hours.length > 0 && hours.some((h) => h > 0)
            ? <div className="bars" role="img" aria-label={`Events per hour over the last 24 hours, peak ${Math.max(...hours)}`}>{barHeights(hours).map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
            : <p className="mu" style={{ margin: 0 }}>No events in the last 24 hours.</p>}
        </section>
        <section className="card padded">
          <h2>Getting started</h2>
          <div className="check"><span className="bd ok">Done</span> Create your organization</div>
          <div className="check"><span className="bd ok">Done</span> Create your first project</div>
          <div className="check">
            {cap?.state === 'connected' ? <span className="bd ok">Done</span> : <span className="bd">Next</span>}
            <span>{cap?.state === 'connected' ? 'Connect your app' : <a href="#/setup">Connect your app</a>}</span>
          </div>
        </section>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="pad"><h2>Integration status</h2></div>
        <div className="tablewrap">
          <table className="tb" style={{ minWidth: 0 }}>
            <thead><tr><th scope="col">Integration</th><th scope="col">Status</th><th scope="col">Detail</th></tr></thead>
            <tbody>
              <tr>
                <td>Monitor SDK</td>
                <td>{cap ? <CapabilityBadge state={cap.state} /> : <span className="bd">Checking</span>}</td>
                <td className="mu">{cap?.state === 'connected' ? `Last event ${formatDate(cap.last_success_at ?? '')}` : (cap?.reason ?? '')} {cap && cap.state !== 'connected' && <a href="#/setup">Open setup</a>}</td>
              </tr>
              {['Paystack', 'Stripe', 'Codex Mail'].map((n) => <tr key={n}><td>{n}</td><td><span className="bd">Not configured</span></td><td className="mu">Arrives in a later release</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="mu pad" style={{ margin: 0 }}>Connected means a real event has arrived. It changes to Degraded after 24 hours of silence.</p>
      </section>
    </>
  )
}
