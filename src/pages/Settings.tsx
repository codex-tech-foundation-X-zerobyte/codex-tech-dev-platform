import { useWs } from '../lib/ws'
import { canViewAudit } from '../lib/perms'
import { SettingsProject } from './SettingsProject'
import { Members } from './Members'
import { AuditLog } from './AuditLog'
import { OrgSettings } from './OrgSettings'

const TABS: [string, string][] = [['project', 'Project'], ['members', 'Members'], ['audit', 'Audit log'], ['organization', 'Organization']]

export function Settings({ tab }: { tab: string }) {
  const { org } = useWs()
  const cur = TABS.some(([k]) => k === tab) ? tab : 'project'
  return (
    <>
      <h1>Settings</h1>
      <p className="mu h-sub">{org.name}</p>
      <nav className="tabs" aria-label="Settings">
        {TABS.filter(([k]) => k !== 'audit' || canViewAudit(org.role)).map(([k, n]) => (
          <a key={k} href={`#/settings/${k}`} aria-current={cur === k ? 'page' : undefined}>{n}</a>
        ))}
      </nav>
      {cur === 'project' && <SettingsProject />}
      {cur === 'members' && <Members />}
      {cur === 'audit' && <AuditLog />}
      {cur === 'organization' && <OrgSettings />}
    </>
  )
}
