import { useState } from 'react'
import logoUrl from '../assets/logo.svg'
import { getTheme, setTheme, type Theme } from '../lib/theme'

function jump(id: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault()
    const el = document.getElementById(id)
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el?.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
  }
}

const LIVE = [
  ['Errors grouped by cause', 'The same bug with different ids and line numbers becomes one group. Resolve it, ignore it, and it reopens on its own if it comes back.'],
  ['A connection you can trust', 'An integration shows Connected only after a real event arrives. After 24 hours of silence it shows Degraded, with the reason.'],
  ['Projects and environments', 'Every project starts with Production and Development. Each ingestion key belongs to exactly one environment.'],
  ['Safe by default', 'Passwords, tokens, JWTs, Codex keys and card numbers are removed before anything is stored.'],
  ['Roles and an audit log', 'Owner, Admin, Developer and Viewer, with every change recorded for owners and admins to review.'],
  ['One strict, simple API', 'A single endpoint with clear errors, safe re-sends, and limits that protect you from runaway loops.'],
] as const

const SOON = [
  ['Alerts', 'In-app and signed webhook alerts, with a delivery history that shows failures honestly.'],
  ['Payment visibility', 'Paystack and Stripe activity, reported per currency and never silently converted.'],
  ['Codex Mail', 'Email delivery for your alerts and your own apps.'],
  ['More modules', 'Dependencies, Repo, Deploy and SDK Hub are planned.'],
] as const

const STEPS = [
  ['1', 'Create a project', 'Sign up, create an organization and a project. Production and Development are ready for you.'],
  ['2', 'Create a key and send an event', 'Copy a key once, run one command, and watch the status change to Connected when the event lands.'],
  ['3', 'Triage what matters', 'See errors grouped by cause with stack traces, counts and first and last seen. Resolve or ignore with one click.'],
] as const

const FAQ = [
  ['What is Codex?', 'Codex Tech Developers Platform is a place to connect, monitor and manage your projects. Today it includes Codex Monitor for errors and events. More modules are planned.'],
  ['Which languages and frameworks work?', 'Anything that can send an HTTPS request. The API is plain JSON, so there is nothing to install to get started. Official SDKs are planned.'],
  ['How does Codex know my app is connected?', 'It waits for a real event from your app. Creating a key does not count. If your app then goes quiet for 24 hours, the status changes to Degraded.'],
  ['What happens to sensitive data?', 'Common secrets and card numbers are removed before storage. Redaction catches known patterns, so avoid sending data you do not want stored.'],
  ['Can my whole team use it?', 'Yes. Add teammates who already have a Codex account and give each a role. Developers manage keys and errors, Viewers read only, and owners control the organization.'],
  ['When do alerts and payment monitoring arrive?', 'They are planned for the launch in late January 2027. Dates and features may change before launch.'],
  ['What does it cost?', 'Codex will be billed monthly. Plans and prices will be announced before launch. You are not charged anything today because billing is not turned on yet.'],
  ['Can I delete my data?', 'Yes. Deleting a project or an organization removes everything stored under it.'],
] as const

const SNIPPET = `// Inside your error handler (Node.js shown; any language works)
await fetch(INGEST_URL, {            // shown on your Setup page
  method: 'POST',
  headers: { Authorization: 'Bearer ' + CODEX_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ events: [{
    event_id: crypto.randomUUID(),
    type: 'error',
    occurred_at: new Date().toISOString(),
    error: { type: err.name, message: err.message, stack: err.stack },
  }] }),
})`

export function Landing() {
  const [theme, setT] = useState<Theme>(getTheme())
  function toggle() { const n: Theme = theme === 'light' ? 'dark' : 'light'; setTheme(n); setT(n) }
  return (
    <div className="lp">
      <a className="lp-skip" href="#lp-main" onClick={jump('lp-main')}>Skip to content</a>
      <header className="lp-nav">
        <div className="lp-w lp-navin">
          <a className="lg" href="#/" aria-label="Codex home"><img src={logoUrl} alt="" /> Codex</a>
          <nav className="lp-links" aria-label="Sections">
            <a href="#/" onClick={jump('features')}>Features</a>
            <a href="#/" onClick={jump('how')}>How it works</a>
            <a href="#/" onClick={jump('security')}>Security</a>
            <a href="#/" onClick={jump('pricing')}>Pricing</a>
            <a href="#/" onClick={jump('faq')}>FAQ</a>
          </nav>
          <div className="row">
            <button className="btn sm" type="button" onClick={toggle}>Theme: {theme === 'light' ? 'Light' : 'Dark'}</button>
            <a className="btn sm" href="#/signin">Sign in</a>
            <a className="btn sm pri" href="#/signup">Get started</a>
          </div>
        </div>
      </header>

      <main id="lp-main">
        <section className="lp-w lp-hero">
          <span className="bd ac">Early access</span>
          <h1>Know what broke before your customers tell you.</h1>
          <p className="lp-lead">Codex Monitor collects errors from any app with one simple HTTP call, groups them by cause, and shows whether your integration is really connected. Any language, any infrastructure.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <a className="btn pri lg-btn" href="#/signup">Create your account</a>
            <a className="btn lg-btn" href="#/signin">Sign in</a>
          </div>
          <p className="mu sm" style={{ margin: '12px 0 0' }}>No card needed. Billing is not turned on yet.</p>
        </section>

        <section className="lp-w" aria-label="Product preview">
          <div className="card lp-mock">
            <div className="row between wrap" style={{ marginBottom: 16 }}>
              <strong>Acme / Web / Production</strong>
              <span className="mu sm">Illustration with sample data</span>
            </div>
            <div className="lp-tiles">
              <div className="card inner"><div className="mu sm">Events, last 24 hours</div><div className="lp-big">1,240</div></div>
              <div className="card inner"><div className="mu sm">Open error groups</div><div className="lp-big">14</div></div>
              <div className="card inner"><div className="mu sm">Monitor SDK</div><div style={{ marginTop: 8 }}><span className="bd ok">Connected</span></div></div>
            </div>
            <div className="tablewrap" style={{ marginTop: 16 }}>
              <table className="tb" style={{ minWidth: 0 }}>
                <thead><tr><th scope="col">Error</th><th scope="col">Events</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  <tr><td>TypeError: Cannot read properties of undefined</td><td>412</td><td><span className="bd wn">Open</span></td></tr>
                  <tr><td>PaymentVerifyError: signature mismatch</td><td>38</td><td><span className="bd wn">Open</span></td></tr>
                  <tr><td>TimeoutError: database query exceeded 5s</td><td>9</td><td><span className="bd ok">Resolved</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <p className="lp-stack mu">Works with anything that can make an HTTPS request: Node.js, Python, Go, PHP, Ruby, Java, .NET and more.</p>
        </section>

        <section className="lp-w lp-sec" id="features" aria-labelledby="h-features">
          <h2 id="h-features">Built to be believed</h2>
          <p className="mu lp-sub">Most dashboards show green until something quietly breaks. Codex only shows what it has actually seen.</p>
          <div className="lp-grid">
            {LIVE.map(([t, d]) => (
              <div className="card" key={t}><span className="bd ok">Available now</span><h3>{t}</h3><p className="mu">{d}</p></div>
            ))}
          </div>
          <h3 className="lp-soon">Coming next</h3>
          <div className="lp-grid lp-grid4">
            {SOON.map(([t, d]) => (
              <div className="card" key={t}><span className="bd">Planned</span><h3>{t}</h3><p className="mu">{d}</p></div>
            ))}
          </div>
        </section>

        <section className="lp-w lp-sec" id="how" aria-labelledby="h-how">
          <h2 id="h-how">From sign-up to your first error in minutes</h2>
          <div className="lp-grid lp-grid3">
            {STEPS.map(([n, t, d]) => (
              <div className="card" key={n}><div className="num">{n}</div><h3>{t}</h3><p className="mu">{d}</p></div>
            ))}
          </div>
          <div className="code lp-code" tabIndex={0} aria-label="Example request">{SNIPPET}</div>
        </section>

        <section className="lp-w lp-sec" id="security" aria-labelledby="h-sec">
          <h2 id="h-sec">Security and privacy, in plain words</h2>
          <p className="mu lp-sub">The protections below are built and tested. We list what exists today, not what we hope to build.</p>
          <ul className="lp-list">
            <li><strong>Keys are shown once.</strong> Only a one-way hash is stored, so even we cannot read your key back.</li>
            <li><strong>Every organization is separate.</strong> Isolation is enforced in the database and covered by automated tests that try to cross the line.</li>
            <li><strong>Secrets are removed before storage.</strong> Passwords, tokens, JWTs, Codex keys and card numbers never reach the database.</li>
            <li><strong>Roles limit what people can do.</strong> Viewers cannot see keys, and only owners can delete an organization.</li>
            <li><strong>Everything important is logged.</strong> Owners and admins can review who changed what.</li>
            <li><strong>Abuse is limited.</strong> Per-key rate limits, repeated wrong-key blocking and monthly caps protect you and the platform.</li>
            <li><strong>You can delete your data.</strong> Removing a project or organization removes what is stored under it.</li>
          </ul>
        </section>

        <section className="lp-w lp-sec" id="pricing" aria-labelledby="h-price">
          <h2 id="h-price">Simple monthly pricing, announced before launch</h2>
          <div className="card lp-price">
            <p style={{ margin: 0 }}>Codex will be billed monthly, with plans that grow with your event volume. We will publish plans and prices before the launch in late January 2027. Billing is not turned on, so you are not charged anything today.</p>
            <a className="btn pri" href="#/signup">Create your account</a>
          </div>
        </section>

        <section className="lp-w lp-sec" id="faq" aria-labelledby="h-faq">
          <h2 id="h-faq">Questions</h2>
          <div className="lp-faq">
            {FAQ.map(([q, a]) => (
              <details key={q}><summary>{q}</summary><p className="mu">{a}</p></details>
            ))}
          </div>
        </section>

        <section className="lp-w lp-cta">
          <h2>Start seeing what your app is really doing.</h2>
          <div className="row" style={{ justifyContent: 'center' }}>
            <a className="btn pri lg-btn" href="#/signup">Create your account</a>
            <a className="btn lg-btn" href="#/signin">Sign in</a>
          </div>
        </section>
      </main>

      <footer className="lp-w lp-foot">
        <span className="mu">Codex Tech Developers Platform. Prices and features may change before launch.</span>
      </footer>
    </div>
  )
}
