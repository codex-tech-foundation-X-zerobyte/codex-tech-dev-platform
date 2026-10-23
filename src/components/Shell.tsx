import type { ReactNode } from 'react'
import { useState } from 'react'
import logoUrl from '../assets/logo.svg'
import { getTheme, setTheme, type Theme } from '../lib/theme'
import { ROLE_LABEL } from '../lib/perms'
import { useWs } from '../lib/ws'

const NEW = '__new'

export function Shell({ path, children }: { path: string; children: ReactNode }) {
  const ws = useWs()
  const [theme, setT] = useState<Theme>(getTheme())
  const inSettings = path.startsWith('/settings')
  const inErrors = path.startsWith('/errors')
  function toggle() { const n: Theme = theme === 'light' ? 'dark' : 'light'; setTheme(n); setT(n) }
  function onOrg(v: string) { if (v === NEW) window.location.hash = '#/new-org'; else { ws.setOrg(v); window.location.hash = '#/' } }
  function onProject(v: string) { if (v === NEW) window.location.hash = '#/new-project'; else { ws.setProject(v); window.location.hash = '#/' } }
  return (
    <div className="app">
      <aside className="sb">
        <div className="lg"><img src={logoUrl} alt="" /> Codex</div>
        <label className="sr-only" htmlFor="org-sel">Organization</label>
        <select id="org-sel" className="in" value={ws.org.id} onChange={(e) => onOrg(e.target.value)}>
          {ws.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value={NEW}>New organization...</option>
        </select>
        <label className="sr-only" htmlFor="proj-sel">Project</label>
        <select id="proj-sel" className="in" value={ws.project?.id ?? ''} onChange={(e) => onProject(e.target.value)}>
          {ws.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value={NEW}>New project...</option>
        </select>
        <nav aria-label="Main" style={{ display: 'contents' }}>
          <a className={`ni${path === '/' ? ' cur' : ''}`} href="#/" aria-current={path === '/' ? 'page' : undefined}>Overview</a>
          <a className={`ni${inErrors ? ' cur' : ''}`} href="#/errors" aria-current={inErrors ? 'page' : undefined}>Errors</a>
          <a className={`ni${path === '/setup' ? ' cur' : ''}`} href="#/setup" aria-current={path === '/setup' ? 'page' : undefined}>Setup</a>
          <a className={`ni${inSettings ? ' cur' : ''}`} href="#/settings/project" aria-current={inSettings ? 'page' : undefined}>Settings</a>
        </nav>
        <div className="grp">Coming next</div>
        {['Alerts', 'Payments', 'Modules'].map((n) => <span key={n} className="ni dis" aria-disabled="true">{n}</span>)}
      </aside>
      <div className="main">
        <header className="top">
          <span className="mu">{ws.org.name}{ws.project ? ` / ${ws.project.name}` : ''}</span>
          <div className="row wrap">
            <button className="btn sm" type="button" onClick={toggle}>Theme: {theme === 'light' ? 'Light' : 'Dark'}</button>
            <span className="mu">{ws.email} ({ROLE_LABEL[ws.org.role]})</span>
            <button className="btn sm" type="button" onClick={ws.signOut}>Sign out</button>
          </div>
        </header>
        <main className="ct">{children}</main>
      </div>
    </div>
  )
}
