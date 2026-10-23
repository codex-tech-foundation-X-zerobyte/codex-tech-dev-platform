import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { api, type Org, type Project } from './lib/api'
import { WsCtx, type Ws } from './lib/ws'
import { Auth } from './components/Auth'
import { Landing } from './components/Landing'
import { SignedInAs } from './components/SignedInAs'
import { Shell } from './components/Shell'
import { CreateOrg, CreateProject } from './pages/Create'
import { Overview } from './pages/Overview'
import { Settings } from './pages/Settings'
import { Errors } from './pages/Errors'
import { ErrorDetail } from './pages/ErrorDetail'
import { Setup } from './pages/Setup'
import { Debug } from './pages/Debug'

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash.slice(1).split('?')[0] || '/'
}

// Remembering the last org and project is a per-browser convenience; the server decides what the user may see.
const ORG_KEY = (u: string) => `codex-org-${u}`
const PROJECT_KEY = (o: string) => `codex-project-${o}`
function load(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } }
function store(k: string, v: string | null) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch { /* storage unavailable */ } }

function Workspace({ session }: { session: Session }) {
  const userId = session.user.id
  const path = useHash()
  const [orgs, setOrgs] = useState<Org[] | null>(null)
  const [orgId, setOrgId] = useState<string | null>(() => load(ORG_KEY(userId)))
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const refreshOrgs = useCallback(async (prefer?: string) => {
    try {
      const list = await api.myOrgs()
      setOrgs(list)
      setOrgId((cur) => {
        const next = prefer && list.some((o) => o.id === prefer) ? prefer : cur && list.some((o) => o.id === cur) ? cur : list[0]?.id ?? null
        store(ORG_KEY(userId), next)
        return next
      })
      setError('')
    } catch (e) { setError((e as Error).message) }
  }, [userId])
  useEffect(() => { void refreshOrgs() }, [refreshOrgs])

  const refreshProjects = useCallback(async (prefer?: string) => {
    if (!orgId) { setProjects([]); setProjectId(null); return }
    try {
      const list = await api.projects(orgId)
      setProjects(list)
      setProjectId((cur) => {
        const saved = load(PROJECT_KEY(orgId))
        const next = prefer && list.some((p) => p.id === prefer) ? prefer
          : cur && list.some((p) => p.id === cur) ? cur
          : saved && list.some((p) => p.id === saved) ? saved : list[0]?.id ?? null
        store(PROJECT_KEY(orgId), next)
        return next
      })
      setError('')
    } catch (e) { setError((e as Error).message) }
  }, [orgId])
  useEffect(() => { setProjects(null); void refreshProjects() }, [refreshProjects])

  if (error) return <div className="center"><div><div className="card padded"><div className="msg err" role="alert">{error}</div><button className="btn" type="button" onClick={() => { setError(''); void refreshOrgs() }}>Try again</button></div><SignedInAs email={session.user.email ?? ''} /></div></div>
  if (orgs === null) return <div className="center mu" role="status">Loading...</div>
  if (orgs.length === 0) {
    return <div className="center"><div><CreateOrg onDone={(id) => void refreshOrgs(id)} /><SignedInAs email={session.user.email ?? ''} /></div></div>
  }
  const org = orgs.find((o) => o.id === orgId) ?? orgs[0]
  if (projects === null) return <div className="center mu" role="status">Loading...</div>
  const project = projects.find((p) => p.id === projectId) ?? null

  const ws: Ws = {
    email: session.user.email ?? '', userId, orgs, org, projects, project,
    setOrg: (id) => { store(ORG_KEY(userId), id); setOrgId(id) },
    setProject: (id) => { store(PROJECT_KEY(org.id), id); setProjectId(id) },
    refreshOrgs, refreshProjects,
    signOut: () => { void supabase.auth.signOut() },
  }

  const needProject = projects.length === 0 && (path === '/' || path.startsWith('/errors') || path === '/setup' || path === '/settings/project' || path === '/new-project')
  const done = () => { window.location.hash = '#/' }
  let page
  if (needProject || path === '/new-project') page = <CreateProject orgId={org.id} onDone={async (id) => { await refreshProjects(id); done() }} />
  else if (path === '/new-org') page = <CreateOrg onDone={async (id) => { await refreshOrgs(id); done() }} />
  else if (path === '/errors') page = <Errors />
  else if (path.startsWith('/errors/')) page = <ErrorDetail id={path.split('/')[2]} />
  else if (path === '/setup') page = <Setup />
  else if (path === '/debug') page = <Debug />
  else if (path.startsWith('/settings')) page = <Settings tab={path.split('/')[2] ?? 'project'} />
  else page = <Overview />

  return <WsCtx.Provider value={ws}><Shell path={path}>{page}</Shell></WsCtx.Provider>
}

function SignedOut() {
  const path = useHash()
  if (path === '/signin' || path === '/signup') return <Auth initialMode={path === '/signup' ? 'up' : 'in'} />
  return <Landing />
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [recovery, setRecovery] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="center mu" role="status">Loading...</div>
  if (!session) return <SignedOut />
  if (recovery) return <Auth recovery onRecovered={() => setRecovery(false)} />
  return <Workspace session={session} />
}
