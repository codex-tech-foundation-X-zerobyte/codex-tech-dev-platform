// Mirrors the role rules enforced by the database (docs/contracts.md, Contract E). The database is the real gate; this only decides what to show.
export type OrgRole = 'owner' | 'admin' | 'developer' | 'viewer'
export const ROLES: OrgRole[] = ['owner', 'admin', 'developer', 'viewer']
export const ROLE_LABEL: Record<OrgRole, string> = { owner: 'Owner', admin: 'Admin', developer: 'Developer', viewer: 'Viewer' }
export const ROLE_HELP: Record<OrgRole, string> = {
  owner: 'Everything, including billing and deleting the organization',
  admin: 'Projects, integrations and non-owner members',
  developer: 'View data, manage alerts and keys',
  viewer: 'Read only',
}

export const canManageStructure = (r: OrgRole) => r === 'owner' || r === 'admin'
export const canManageMembers = canManageStructure
export const canViewAudit = canManageStructure
export const canDeleteOrg = (r: OrgRole) => r === 'owner'

export function assignableRoles(actor: OrgRole): OrgRole[] {
  if (actor === 'owner') return ROLES
  if (actor === 'admin') return ['admin', 'developer', 'viewer']
  return []
}

export function canChangeMember(actor: OrgRole, target: OrgRole, isSelf: boolean): boolean {
  if (!canManageMembers(actor) || isSelf) return false
  return target !== 'owner' || actor === 'owner'
}
export function canRemoveMember(actor: OrgRole, target: OrgRole, isSelf: boolean): boolean {
  if (isSelf) return true
  return canManageMembers(actor) && (target !== 'owner' || actor === 'owner')
}
export const canManageMonitor = (r: OrgRole) => r === 'owner' || r === 'admin' || r === 'developer'
