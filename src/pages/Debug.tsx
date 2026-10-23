import { useState } from 'react'
import { configuredEndpoint, configuredHost, configuredKeyPrefix, getStats, isSelfMonitorOn, reportError } from '../lib/selfMonitor'

function Bomb(): never { throw new Error('Codex self-test: render error') }

// Hidden page (#/debug) for checking that this app reports its own errors. Not linked from the menu.
export function Debug() {
  const [, tick] = useState(0)
  const [crash, setCrash] = useState(false)
  const refresh = () => window.setTimeout(() => tick((n) => n + 1), 1200)
  if (crash) return <Bomb />
  if (!isSelfMonitorOn()) {
    return (
      <>
        <h1>Self-monitoring is off</h1>
        <p className="mu">Set <span className="mono">VITE_SELF_MONITOR_KEY</span> to an ingestion key from a dedicated project, rebuild the app, and open this page again. See the README.</p>
      </>
    )
  }
  const s = getStats()
  const blocked = s.failed > 0 && /blocked before it reached/.test(s.last)
  const origin = window.location.origin
  const check = `Invoke-WebRequest -UseBasicParsing -Method Options -Uri '${configuredEndpoint()}' -Headers @{ Origin = '${origin}'; 'Access-Control-Request-Method' = 'POST'; 'Access-Control-Request-Headers' = 'authorization, content-type' } | Select-Object StatusCode, @{ n = 'AllowOrigin'; e = { $_.Headers['Access-Control-Allow-Origin'] } }`
  return (
    <>
      <h1>Self-monitoring test</h1>
      <p className="mu h-sub">Sends test errors from this browser to <span className="mono">{configuredHost()}</span> using key <span className="mono">{configuredKeyPrefix()}...</span>. They appear under Errors in the project that owns the key.</p>
      <section className="card padded">
        <div className="row wrap">
          <button className="btn pri" type="button" onClick={() => { reportError(new Error('Codex self-test: handled error'), { source: 'debug' }); refresh() }}>Send a handled error</button>
          <button className="btn" type="button" onClick={() => { window.setTimeout(() => { throw new Error('Codex self-test: unhandled error') }, 0); refresh() }}>Throw an unhandled error</button>
          <button className="btn" type="button" onClick={() => { void Promise.reject(new Error('Codex self-test: unhandled rejection')); refresh() }}>Reject a promise</button>
          <button className="btn danger" type="button" onClick={() => setCrash(true)}>Crash this screen</button>
        </div>
        <p className="mu" style={{ margin: '16px 0 0' }} aria-live="polite">Last result: {s.last}</p>
        <p className="mu sm" style={{ margin: '4px 0 0' }}>Sent {s.sent}. Failed {s.failed}. Held back as repeats {s.deduped}. Held back by the limit of 10 a minute {s.throttled}.</p>
        <p className="mu sm" style={{ margin: '12px 0 0' }}>The same error is only sent once a minute, so press a button once, then wait. "Crash this screen" shows the error page and needs a reload afterwards.</p>
      </section>
      {blocked && (
        <section className="card padded" style={{ marginTop: 16 }}>
          <h2>The browser blocked the request. Check these, in order</h2>
          <ol className="mu" style={{ margin: '0 0 12px', paddingLeft: 20 }}>
            <li>Deploy the function from the latest code, with JWT checking off: <span className="mono">supabase functions deploy ingest --no-verify-jwt</span>. With JWT checking on, Supabase refuses the browser's preflight before the function runs.</li>
            <li>Allow this exact site: <span className="mono">supabase secrets set CORS_ALLOW_ORIGINS={origin}</span>. It takes effect immediately. The function log prints which origins it accepted when it starts.</li>
            <li>Make sure the key belongs to this Supabase project and has not been revoked.</li>
          </ol>
          <p className="mu" style={{ margin: '0 0 8px' }}>To see exactly what the function answers, run this in PowerShell. A healthy answer is StatusCode 204 and AllowOrigin <span className="mono">{origin}</span>. A 401 means step 1 is not done. An empty AllowOrigin means step 2 is not done, or the function still has the old code.</p>
          <div className="code" tabIndex={0}>{check}</div>
        </section>
      )}
    </>
  )
}
