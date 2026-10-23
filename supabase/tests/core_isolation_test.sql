-- Tenant isolation and role tests for 20261021000003_core.sql. LOCAL throwaway Postgres only.
-- Run after stub_supabase.sql, 0001, 0002, 0003 (see run_local.sh). Every check records PASS or FAIL in t.results.
\set ON_ERROR_STOP on

create schema t;
create table t.results (n bigint generated always as identity, name text, ok boolean, detail text);
create function t.check(p_name text, p_ok boolean) returns void language sql as
  $$ insert into t.results (name, ok) values (p_name, coalesce(p_ok, false)) $$;
create function t.eq(p_name text, p_actual text, p_expected text) returns void language sql as
  $$ insert into t.results (name, ok, detail) values (p_name, p_actual is not distinct from p_expected,
       case when p_actual is not distinct from p_expected then null else 'expected ' || coalesce(p_expected,'null') || ' got ' || coalesce(p_actual,'null') end) $$;
create function t.throws(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare ok boolean := false; msg text := 'no error';
begin
  begin
    execute p_sql;
  exception when others then
    msg := sqlerrm || ' [' || sqlstate || ']';
    ok := (sqlerrm = p_expect) or (sqlstate = p_expect);
  end;
  insert into t.results (name, ok, detail) values (p_name, ok, case when ok then null else 'expected ' || p_expect || ' got ' || msg end);
end $$;
grant usage on schema t to public;
grant all on t.results to public;
grant execute on all functions in schema t to public;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000000001', 'a-owner@x.com'),
 ('00000000-0000-0000-0000-000000000002', 'a-admin@x.com'),
 ('00000000-0000-0000-0000-000000000003', 'a-dev@x.com'),
 ('00000000-0000-0000-0000-000000000004', 'a-viewer@x.com'),
 ('00000000-0000-0000-0000-000000000005', 'b-owner@x.com'),
 ('00000000-0000-0000-0000-000000000006', 'c-owner@x.com'),
 ('00000000-0000-0000-0000-000000000007', 'extra@x.com');
\set u1 '00000000-0000-0000-0000-000000000001'
\set u2 '00000000-0000-0000-0000-000000000002'
\set u3 '00000000-0000-0000-0000-000000000003'
\set u4 '00000000-0000-0000-0000-000000000004'
\set u5 '00000000-0000-0000-0000-000000000005'
\set u6 '00000000-0000-0000-0000-000000000006'
\set u7 '00000000-0000-0000-0000-000000000007'
\set ghost '00000000-0000-0000-0000-0000000000ff'

-- ===== setup through the real RPCs =====
set role authenticated;
select set_config('request.jwt.claim.sub', :'u1', false);
select (public.create_organization('Acme', 'acme')->>'id') as orgA \gset
select (public.project_create(:'orga', 'Web', 'web')->>'id') as projA \gset
select public.org_member_add(:'orga', 'a-admin@x.com', 'admin');
select public.org_member_add(:'orga', 'a-dev@x.com', 'developer');
select public.org_member_add(:'orga', 'a-viewer@x.com', 'viewer');
select e->>'id' as envA from jsonb_array_elements(public.project_list(:'orga')->0->'environments') e limit 1 \gset

select set_config('request.jwt.claim.sub', :'u5', false);
select (public.create_organization('Beta', 'beta')->>'id') as orgB \gset
select (public.project_create(:'orgb', 'Api', 'api')->>'id') as projB \gset
select e->>'id' as envB from jsonb_array_elements(public.project_list(:'orgb')->0->'environments') e limit 1 \gset

select set_config('request.jwt.claim.sub', :'u6', false);
select (public.create_organization('Solo', 'solo')->>'id') as orgC \gset

-- ===== defaults =====
select set_config('request.jwt.claim.sub', :'u1', false);
select t.eq('new project gets 2 default environments', jsonb_array_length(public.project_list(:'orga')->0->'environments')::text, '2');
select t.eq('creator is owner', (select role from core.memberships where user_id = :'u1' and org_id = :'orga'), 'owner');

-- ===== tenant isolation: reads (row-level security on the tables) =====
select t.eq('A1 sees only org A in organizations', (select count(*) from core.organizations)::text, '1');
select t.eq('A1 sees no org B membership rows', (select count(*) from core.memberships where org_id = :'orgb')::text, '0');
select t.eq('A1 sees no org B projects', (select count(*) from core.projects where org_id = :'orgb')::text, '0');
select t.eq('A1 sees no org B environments', (select count(*) from core.environments where org_id = :'orgb')::text, '0');
select t.eq('A1 sees no org B audit rows', (select count(*) from core.audit_log where org_id = :'orgb')::text, '0');
select t.eq('A1 sees all 4 org A members', (select count(*) from core.memberships where org_id = :'orga')::text, '4');
select t.eq('core._role(org B) is null for A1', coalesce(core._role(:'orgb'), 'null'), 'null');
select t.eq('my_organizations lists only org A', jsonb_array_length(public.my_organizations())::text, '1');
select t.throws('A1 cannot list org B projects', format('select public.project_list(%L)', :'orgb'), '42501');
select t.throws('A1 cannot list org B members', format('select public.org_members(%L)', :'orgb'), '42501');
select t.throws('A1 cannot read org B audit', format('select public.org_audit_list(%L)', :'orgb'), '42501');

-- ===== tenant isolation: writes =====
select t.throws('A1 cannot create project in org B', format('select public.project_create(%L,%L,%L)', :'orgb', 'x', 'xx'), '42501');
select t.throws('A1 cannot add member to org B', format('select public.org_member_add(%L,%L,%L)', :'orgb', 'extra@x.com', 'viewer'), '42501');
select t.throws('A1 cannot delete org B', format('select public.delete_organization(%L)', :'orgb'), '42501');
select t.throws('A1 cannot delete project B', format('select public.project_delete(%L)', :'projb'), '42501');
select t.throws('A1 cannot create env in project B', format('select public.environment_create(%L,%L,%L)', :'projb', 'Staging', 'staging'), '42501');
select t.throws('A1 cannot delete env B', format('select public.environment_delete(%L)', :'envb'), '42501');
select t.throws('A1 cannot change org B roles', format('select public.org_member_set_role(%L,%L,%L)', :'orgb', :'u5', 'viewer'), '42501');
select t.throws('A1 cannot remove org B owner', format('select public.org_member_remove(%L,%L)', :'orgb', :'u5'), '42501');
select t.throws('unknown project id looks the same (forbidden)', format('select public.project_delete(%L)', :'ghost'), '42501');
select t.throws('unknown env id looks the same (forbidden)', format('select public.environment_delete(%L)', :'ghost'), '42501');

-- ===== direct table writes and helper functions are not reachable from the browser role =====
select t.throws('direct insert into organizations denied', $$insert into core.organizations (name, slug) values ('x', 'xx')$$, '42501');
select t.throws('direct role self-promotion denied', format('update core.memberships set role = %L where user_id = %L', 'owner', :'u2'), '42501');
select t.throws('direct delete of projects denied', 'delete from core.projects', '42501');
select t.throws('direct insert into memberships denied', format('insert into core.memberships (org_id, user_id, role) values (%L,%L,%L)', :'orgb', :'u1', 'owner'), '42501');
select t.throws('direct write to audit log denied', format('insert into core.audit_log (org_id, action) values (%L,%L)', :'orga', 'x'), '42501');
select t.throws('core._require not callable', format('select core._require(%L::uuid, array[%L])', :'orga', 'owner'), '42501');
select t.throws('core._log not callable', format('select core._log(%L::uuid, %L, %L)', :'orga', 'x', 'y'), '42501');

-- ===== anon and signed-out =====
reset role; set role anon;
select t.throws('anon cannot read organizations', 'select * from core.organizations', '42501');
select t.throws('anon cannot read projects', 'select * from core.projects', '42501');
select t.throws('anon cannot call create_organization', $$select public.create_organization('x','xx')$$, '42501');
select t.throws('anon cannot call my_organizations', 'select public.my_organizations()', '42501');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
select t.throws('no user id cannot create org', $$select public.create_organization('x','xx')$$, 'forbidden');
select t.eq('no user id sees no orgs', (select count(*) from core.organizations)::text, '0');
select t.eq('no user id my_organizations is empty', jsonb_array_length(public.my_organizations())::text, '0');

-- ===== viewer: read only =====
select set_config('request.jwt.claim.sub', :'u4', false);
select t.eq('viewer can list projects', jsonb_array_length(public.project_list(:'orga'))::text, '1');
select t.eq('viewer can list members', jsonb_array_length(public.org_members(:'orga'))::text, '4');
select t.throws('viewer cannot create project', format('select public.project_create(%L,%L,%L)', :'orga', 'x', 'xx'), 'forbidden');
select t.throws('viewer cannot create env', format('select public.environment_create(%L,%L,%L)', :'proja', 'Staging', 'staging'), 'forbidden');
select t.throws('viewer cannot add member', format('select public.org_member_add(%L,%L,%L)', :'orga', 'extra@x.com', 'viewer'), 'forbidden');
select t.throws('viewer cannot change roles', format('select public.org_member_set_role(%L,%L,%L)', :'orga', :'u3', 'viewer'), 'forbidden');
select t.throws('viewer cannot remove others', format('select public.org_member_remove(%L,%L)', :'orga', :'u3'), 'forbidden');
select t.throws('viewer cannot delete project', format('select public.project_delete(%L)', :'proja'), 'forbidden');
select t.throws('viewer cannot delete org', format('select public.delete_organization(%L)', :'orga'), 'forbidden');
select t.throws('viewer cannot read audit (rpc)', format('select public.org_audit_list(%L)', :'orga'), 'forbidden');
select t.eq('viewer sees no audit rows (rls)', (select count(*) from core.audit_log)::text, '0');

-- ===== developer: read only for org structure =====
select set_config('request.jwt.claim.sub', :'u3', false);
select t.eq('developer can list projects', jsonb_array_length(public.project_list(:'orga'))::text, '1');
select t.throws('developer cannot create project', format('select public.project_create(%L,%L,%L)', :'orga', 'x', 'xx'), 'forbidden');
select t.throws('developer cannot add member', format('select public.org_member_add(%L,%L,%L)', :'orga', 'extra@x.com', 'viewer'), 'forbidden');
select t.throws('developer cannot delete org', format('select public.delete_organization(%L)', :'orga'), 'forbidden');
select t.throws('developer cannot read audit (rpc)', format('select public.org_audit_list(%L)', :'orga'), 'forbidden');
select t.eq('developer sees no audit rows (rls)', (select count(*) from core.audit_log)::text, '0');

-- ===== admin: manages projects and non-owner members =====
select set_config('request.jwt.claim.sub', :'u2', false);
select (public.project_create(:'orga', 'Mobile', 'mobile')->>'id') as projA2 \gset
select t.check('admin can create project', :'proja2' is not null);
select t.eq('admin can add a developer', public.org_member_add(:'orga', 'extra@x.com', 'developer')->>'role', 'developer');
select t.throws('admin cannot add an owner', format('select public.org_member_add(%L,%L,%L)', :'orga', 'b-owner@x.com', 'owner'), 'forbidden');
select t.throws('admin cannot demote the owner', format('select public.org_member_set_role(%L,%L,%L)', :'orga', :'u1', 'viewer'), 'forbidden');
select t.throws('admin cannot promote to owner', format('select public.org_member_set_role(%L,%L,%L)', :'orga', :'u3', 'owner'), 'forbidden');
select t.throws('admin cannot remove the owner', format('select public.org_member_remove(%L,%L)', :'orga', :'u1'), 'forbidden');
select t.throws('admin cannot delete org', format('select public.delete_organization(%L)', :'orga'), 'forbidden');
select t.throws('admin cannot change own role', format('select public.org_member_set_role(%L,%L,%L)', :'orga', :'u2', 'owner'), 'cannot_change_self');
select t.eq('admin can change developer to viewer', public.org_member_set_role(:'orga', :'u7', 'viewer')->>'role', 'viewer');
select t.eq('admin reads audit', ((public.org_audit_list(:'orga')->>'total')::int > 0)::text, 'true');
select t.eq('admin sees audit rows (rls)', ((select count(*) from core.audit_log) > 0)::text, 'true');
select public.org_member_remove(:'orga', :'u7');
select t.eq('admin can remove a non-owner', (select count(*) from core.memberships where org_id = :'orga' and user_id = :'u7')::text, '0');

-- ===== environments =====
select set_config('request.jwt.claim.sub', :'u1', false);
select (public.environment_create(:'proja', 'Staging', 'staging')->>'id') as envA3 \gset
select t.eq('owner can add environment', jsonb_array_length(public.project_list(:'orga')->0->'environments')::text, '3');
select t.throws('duplicate environment slug rejected', format('select public.environment_create(%L,%L,%L)', :'proja', 'Staging again', 'staging'), 'slug_taken');
select t.throws('invalid environment slug rejected', format('select public.environment_create(%L,%L,%L)', :'proja', 'Bad', '-bad-'), 'invalid_input');
select public.environment_delete(:'enva3');
select public.environment_delete(:'enva');
select e->>'id' as envLast from jsonb_array_elements(public.project_list(:'orga')->0->'environments') e limit 1 \gset
select t.throws('last environment cannot be deleted', format('select public.environment_delete(%L)', :'envlast'), 'last_environment');

-- ===== slugs and validation =====
select t.throws('duplicate org slug rejected', $$select public.create_organization('Dup', 'acme')$$, 'slug_taken');
select t.throws('org slug is case-insensitive', $$select public.create_organization('Dup', 'ACME')$$, 'slug_taken');
select t.throws('too-short slug rejected', $$select public.create_organization('X', 'a')$$, 'invalid_input');
select t.throws('slug with leading dash rejected', $$select public.create_organization('X', '-abc')$$, 'invalid_input');
select t.throws('empty org name rejected', $$select public.create_organization('   ', 'valid-slug')$$, 'invalid_input');
select t.throws('duplicate project slug in same org rejected', format('select public.project_create(%L,%L,%L)', :'orga', 'Web 2', 'web'), 'slug_taken');
select set_config('request.jwt.claim.sub', :'u5', false);
select t.eq('same project slug allowed in another org', (public.project_create(:'orgb', 'Web', 'web')->>'slug'), 'web');
select set_config('request.jwt.claim.sub', :'u1', false);
select t.throws('adding unknown email rejected', format('select public.org_member_add(%L,%L,%L)', :'orga', 'nobody@x.com', 'viewer'), 'user_not_found');
select t.throws('adding existing member rejected', format('select public.org_member_add(%L,%L,%L)', :'orga', 'a-admin@x.com', 'viewer'), 'already_member');
select t.throws('invalid role rejected', format('select public.org_member_add(%L,%L,%L)', :'orga', 'extra@x.com', 'god'), 'invalid_role');

-- ===== owners and the last-owner rule =====
select t.eq('owner can add a second owner', public.org_member_add(:'orga', 'extra@x.com', 'owner')->>'role', 'owner');
select t.eq('owner can demote another owner', public.org_member_set_role(:'orga', :'u7', 'admin')->>'role', 'admin');
select t.throws('owner cannot change own role', format('select public.org_member_set_role(%L,%L,%L)', :'orga', :'u1', 'viewer'), 'cannot_change_self');
select set_config('request.jwt.claim.sub', :'u6', false);
select t.throws('sole owner cannot leave', format('select public.org_member_remove(%L,%L)', :'orgc', :'u6'), 'last_owner');
select t.throws('sole owner cannot demote self', format('select public.org_member_set_role(%L,%L,%L)', :'orgc', :'u6', 'viewer'), 'cannot_change_self');

-- ===== leaving an org =====
select set_config('request.jwt.claim.sub', :'u3', false);
select public.org_member_remove(:'orga', :'u3');
select t.throws('member who left loses access', format('select public.project_list(%L)', :'orga'), 'forbidden');
select t.eq('member who left sees no orgs', jsonb_array_length(public.my_organizations())::text, '0');

-- ===== audit trail =====
select set_config('request.jwt.claim.sub', :'u1', false);
select t.eq('audit has org.create', ((select count(*) from core.audit_log where org_id = :'orga' and action = 'org.create') = 1)::text, 'true');
select t.eq('audit has project.create', ((select count(*) from core.audit_log where org_id = :'orga' and action = 'project.create') = 2)::text, 'true');
select t.eq('audit has member.set_role with from/to', ((select count(*) from core.audit_log where org_id = :'orga' and action = 'member.set_role' and meta ? 'from' and meta ? 'to') >= 1)::text, 'true');
select t.eq('audit has member.leave', ((select count(*) from core.audit_log where org_id = :'orga' and action = 'member.leave') = 1)::text, 'true');
select t.eq('audit pagination limit', jsonb_array_length(public.org_audit_list(:'orga', 2, 0)->'rows')::text, '2');

-- ===== integrity (as the database owner) =====
reset role;
select t.throws('environment must match its project org', format('insert into core.environments (project_id, org_id, name, slug) values (%L,%L,%L,%L)', :'proja', :'orgb', 'x', 'xx'), '23503');
select t.throws('bad role value rejected by constraint', format('insert into core.memberships (org_id, user_id, role) values (%L,%L,%L)', :'orgb', :'u1', 'root'), '23514');

-- ===== deleting an org removes its data =====
set role authenticated;
select set_config('request.jwt.claim.sub', :'u1', false);
select public.delete_organization(:'orga');
reset role;
select t.eq('org delete cascades memberships', (select count(*) from core.memberships where org_id = :'orga')::text, '0');
select t.eq('org delete cascades projects', (select count(*) from core.projects where org_id = :'orga')::text, '0');
select t.eq('org delete cascades environments', (select count(*) from core.environments where org_id = :'orga')::text, '0');
select t.eq('org delete cascades audit rows', (select count(*) from core.audit_log where org_id = :'orga')::text, '0');
select t.eq('other org untouched by delete', (select count(*) from core.projects where org_id = :'orgb')::text, '2');

-- ===== report =====
\echo
\echo '=== FAILURES ==='
select n, name, detail from t.results where not ok order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed, count(*) as total from t.results;
