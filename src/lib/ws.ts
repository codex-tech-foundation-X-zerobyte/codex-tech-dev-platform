import { createContext, useContext } from 'react'
import type { Org, Project } from './api'

export type Ws = {
  email: string
  userId: string
  orgs: Org[]
  org: Org
  projects: Project[]
  project: Project | null
  setOrg: (id: string) => void
  setProject: (id: string) => void
  refreshOrgs: (prefer?: string) => Promise<void>
  refreshProjects: (prefer?: string) => Promise<void>
  signOut: () => void
}
export const WsCtx = createContext<Ws | null>(null)
export function useWs(): Ws {
  const v = useContext(WsCtx)
  if (!v) throw new Error('Workspace context missing')
  return v
}
