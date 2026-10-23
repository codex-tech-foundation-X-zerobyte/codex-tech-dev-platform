import { supabase } from './supabase'
import { reportError } from './selfMonitor'
import type { OrgRole } from './perms'

export type Org = { id: string; name: string; slug: string; role: OrgRole }
export type Env = { id: string; name: string; slug: string }
export type Project = { id: string; name: string; slug: string; created_at: string; environments: Env[] }
export type Member = { user_id: string; email: string; role: OrgRole; created_at: string }
export type AuditRow = { id: number; at: string; actor_email: string | null; action: string; target: string | null; meta: Record<string, unknown> | null }

export type CapabilityState = 'not_configured' | 'setup_required' | 'verifying' | 'connected' | 'degraded' | 'disconnected'
export type Capability = { state: CapabilityState; reason: string | null; last_success_at: string | null; active_keys: number }
export type Overview = { capability: Capability; events_24h: number; open_groups: number; new_groups_24h: number; usage_month: number; monthly_cap: number; hourly: number[] }
export type GroupStatus = 'open' | 'resolved' | 'ignored'
export type ErrorGroup = { id: string; title: string; status: GroupStatus; event_count: number; first_seen: string; last_seen: string; environment_id: string; environment: string }
export type ErrorEvent = {
  id: number; event_id: string; occurred_at: string; severity: string; error_type: string | null; error_message: string | null
  error_stack: string | null; trace_id: string | null; attributes: Record<string, unknown>; sdk_name: string | null; sdk_version: string | null
}
export type IngestKey = { id: string; name: string; prefix: string; environment_id: string; environment: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
export type NewKey = { id: string; name: string; environment_id: string; prefix: string; key: string }
export type GroupFilter = { env?: string | null; status?: GroupStatus | null; search?: string; limit: number; offset: number }

const ERRORS: Record<string, string> = {
  too_many_keys: 'This environment already has 10 active keys. Revoke one first.',
  forbidden: 'You do not have permission to do that.',
  slug_taken: 'That short name is already taken. Try another.',
  invalid_input: 'Check the name and short name. The short name needs 2 to 40 letters, numbers or dashes.',
  invalid_role: 'That role is not valid.',
  user_not_found: 'No account with that email yet. Ask them to create a Codex account first.',
  already_member: 'That person is already a member.',
  cannot_change_self: 'You cannot change your own role.',
  last_owner: 'An organization must keep at least one owner.',
  not_a_member: 'That person is no longer a member.',
  last_environment: 'A project must keep at least one environment.',
}

export function errorMessage(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? ''
  const hit = Object.keys(ERRORS).find((k) => m.includes(k))
  return hit ? ERRORS[hit] : 'Something went wrong. Please try again.'
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    // Known rules (not allowed, name taken, and so on) are normal. Anything else is a real fault worth seeing in our own Monitor.
    if (!Object.keys(ERRORS).some((k) => (error.message ?? '').includes(k))) reportError(new Error(`${fn}: ${error.message}`), { source: 'rpc', fn })
    throw new Error(errorMessage(error))
  }
  return data as T
}

export const api = {
  myOrgs: () => rpc<Org[]>('my_organizations'),
  createOrg: (name: string, slug: string) => rpc<Org>('create_organization', { p_name: name, p_slug: slug }),
  deleteOrg: (org: string) => rpc('delete_organization', { p_org: org }),
  projects: (org: string) => rpc<Project[]>('project_list', { p_org: org }),
  createProject: (org: string, name: string, slug: string) => rpc<{ id: string; name: string; slug: string }>('project_create', { p_org: org, p_name: name, p_slug: slug }),
  deleteProject: (project: string) => rpc('project_delete', { p_project: project }),
  createEnv: (project: string, name: string, slug: string) => rpc('environment_create', { p_project: project, p_name: name, p_slug: slug }),
  deleteEnv: (env: string) => rpc('environment_delete', { p_env: env }),
  members: (org: string) => rpc<Member[]>('org_members', { p_org: org }),
  addMember: (org: string, email: string, role: OrgRole) => rpc('org_member_add', { p_org: org, p_email: email, p_role: role }),
  setRole: (org: string, user: string, role: OrgRole) => rpc('org_member_set_role', { p_org: org, p_user: user, p_role: role }),
  removeMember: (org: string, user: string) => rpc('org_member_remove', { p_org: org, p_user: user }),
  overview: (project: string) => rpc<Overview>('monitor_overview', { p_project: project }),
  groups: (project: string, f: GroupFilter) => rpc<{ total: number; rows: ErrorGroup[] }>('error_groups_list', { p_project: project, p_env: f.env ?? null, p_status: f.status ?? null, p_search: f.search?.trim() || null, p_limit: f.limit, p_offset: f.offset }),
  group: (id: string) => rpc<{ group: ErrorGroup; events: ErrorEvent[] }>('error_group_get', { p_group: id }),
  setGroupStatus: (id: string, status: GroupStatus) => rpc('error_group_set_status', { p_group: id, p_status: status }),
  keys: (project: string) => rpc<IngestKey[]>('ingestion_keys_list', { p_project: project }),
  createKey: (env: string, name: string) => rpc<NewKey>('ingestion_key_create', { p_environment: env, p_name: name }),
  revokeKey: (id: string) => rpc('ingestion_key_revoke', { p_key: id }),
  audit: (org: string, limit: number, offset: number) => rpc<{ total: number; rows: AuditRow[] }>('org_audit_list', { p_org: org, p_limit: limit, p_offset: offset }),
}
