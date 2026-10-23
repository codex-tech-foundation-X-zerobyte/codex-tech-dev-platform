-- Core multi-tenant schema: organizations, memberships, projects, environments, org audit log.
-- Implements Contract E (roles) from docs/contracts.md. Runs after the waitlist and admin migrations on the shared Supabase project.
-- Run once in the Supabase SQL Editor. Never edit after it has been applied; add 0004 instead.
--
-- Access model: the browser never writes to these tables. Writes go through the SECURITY DEFINER functions at the
-- bottom, which check the caller's role. Direct reads are limited by row-level security to organizations the caller
-- belongs to. Project-level membership is not modelled yet: every org member can see every project in the org (D-14).

create schema if not exists core;

create table if not exists core.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists core.memberships (
  org_id     uuid not null references core.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'developer', 'viewer')),
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (org_id, user_id)
);
create index if not exists memberships_user_idx on core.memberships (user_id);

create table if not exists core.projects (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references core.organizations (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  slug       text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, slug),
  unique (id, org_id)
);

-- org_id is repeated on environments so row-level security and tenant checks never need a join.
-- The composite foreign key guarantees it always matches the project's org.
create table if not exists core.environments (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  org_id     uuid not null,
  name       text not null check (char_length(name) between 1 and 80),
  slug       text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'),
  created_at timestamptz not null default now(),
  unique (project_id, slug),
  foreign key (project_id, org_id) references core.projects (id, org_id) on delete cascade
);
create index if not exists environments_org_idx on core.environments (org_id);

create table if not exists core.audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references core.organizations (id) on delete cascade,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null,
  target      text,
  meta        jsonb
);
create index if not exists core_audit_org_at_idx on core.audit_log (org_id, at desc, id desc);

-- ---------- permissions ----------
alter table core.organizations enable row level security;
alter table core.memberships   enable row level security;
alter table core.projects      enable row level security;
alter table core.environments  enable row level security;
alter table core.audit_log     enable row level security;

revoke all on schema core from public, anon, authenticated;
revoke all on all tables in schema core from public, anon, authenticated;

-- ---------- internal helpers ----------
create or replace function core._role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from core.memberships where org_id = p_org and user_id = auth.uid()
$$;

create or replace function core._require(p_org uuid, p_roles text[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r text;
begin
  r := core._role(p_org);
  if auth.uid() is null or r is null or not (r = any (p_roles)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return r;
end $$;

create or replace function core._log(p_org uuid, p_action text, p_target text, p_meta jsonb default null) returns void
language sql security definer set search_path = '' as $$
  insert into core.audit_log (org_id, actor_id, actor_email, action, target, meta)
  values (p_org, auth.uid(), (select email from auth.users where id = auth.uid()), p_action, p_target, p_meta)
$$;

-- A missing id and an id in someone else's org look the same to the caller.
create or replace function core._project_org(p_project uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare o uuid;
begin
  select org_id into o from core.projects where id = p_project;
  if o is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return o;
end $$;

revoke all on function core._require(uuid, text[]) from public, anon, authenticated;
revoke all on function core._log(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function core._project_org(uuid) from public, anon, authenticated;
revoke all on function core._role(uuid) from public, anon;

-- Row-level security policies call core._role as the signed-in user, so that one helper and the schema must be reachable.
grant usage on schema core to authenticated;
grant execute on function core._role(uuid) to authenticated;
grant select on core.organizations, core.memberships, core.projects, core.environments, core.audit_log to authenticated;

drop policy if exists org_select on core.organizations;
create policy org_select on core.organizations for select to authenticated
  using (core._role(id) is not null);
drop policy if exists mem_select on core.memberships;
create policy mem_select on core.memberships for select to authenticated
  using (core._role(org_id) is not null);
drop policy if exists proj_select on core.projects;
create policy proj_select on core.projects for select to authenticated
  using (core._role(org_id) is not null);
drop policy if exists env_select on core.environments;
create policy env_select on core.environments for select to authenticated
  using (core._role(org_id) is not null);
drop policy if exists audit_select on core.audit_log;
create policy audit_select on core.audit_log for select to authenticated
  using (core._role(org_id) in ('owner', 'admin'));

-- ---------- organizations ----------
create or replace function public.create_organization(p_name text, p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n text := btrim(coalesce(p_name, '')); s text := lower(btrim(coalesce(p_slug, ''))); oid uuid;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(n) not between 1 and 80 or s !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  begin
    insert into core.organizations (name, slug, created_by) values (n, s, auth.uid()) returning id into oid;
  exception when unique_violation then
    raise exception 'slug_taken' using errcode = '23505';
  end;
  insert into core.memberships (org_id, user_id, role, created_by) values (oid, auth.uid(), 'owner', auth.uid());
  perform core._log(oid, 'org.create', s, jsonb_build_object('name', n));
  return jsonb_build_object('id', oid, 'name', n, 'slug', s, 'role', 'owner');
end $$;

create or replace function public.delete_organization(p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform core._require(p_org, array['owner']);
  delete from core.organizations where id = p_org;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.my_organizations() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'role', m.role)
                            order by o.created_at, o.id), '[]'::jsonb)
  from core.memberships m join core.organizations o on o.id = m.org_id
  where m.user_id = auth.uid()
$$;

-- ---------- members ----------
create or replace function public.org_members(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform core._require(p_org, array['owner', 'admin', 'developer', 'viewer']);
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role,
                                                       'created_at', m.created_at) order by m.created_at, m.user_id)
                   from core.memberships m join auth.users u on u.id = m.user_id
                   where m.org_id = p_org), '[]'::jsonb);
end $$;

create or replace function public.org_member_add(p_org uuid, p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare caller text; uid uuid;
begin
  caller := core._require(p_org, array['owner', 'admin']);
  if p_role is null or p_role not in ('owner', 'admin', 'developer', 'viewer') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_role = 'owner' and caller <> 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if uid is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from core.memberships where org_id = p_org and user_id = uid) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  insert into core.memberships (org_id, user_id, role, created_by) values (p_org, uid, p_role, auth.uid());
  perform core._log(p_org, 'member.add', uid::text, jsonb_build_object('role', p_role));
  return jsonb_build_object('user_id', uid, 'role', p_role);
end $$;

create or replace function public.org_member_set_role(p_org uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare caller text; cur text;
begin
  caller := core._require(p_org, array['owner', 'admin']);
  if p_role is null or p_role not in ('owner', 'admin', 'developer', 'viewer') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_user = auth.uid() then raise exception 'cannot_change_self' using errcode = '42501'; end if;
  select role into cur from core.memberships where org_id = p_org and user_id = p_user;
  if cur is null then raise exception 'not_a_member' using errcode = 'P0002'; end if;
  if (cur = 'owner' or p_role = 'owner') and caller <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if cur = 'owner' and p_role <> 'owner'
     and (select count(*) from core.memberships where org_id = p_org and role = 'owner') <= 1 then
    raise exception 'last_owner' using errcode = '42501';
  end if;
  update core.memberships set role = p_role where org_id = p_org and user_id = p_user;
  perform core._log(p_org, 'member.set_role', p_user::text, jsonb_build_object('from', cur, 'to', p_role));
  return jsonb_build_object('user_id', p_user, 'role', p_role);
end $$;

-- Any member may remove themselves (leave). Owners and admins may remove others; only owners may remove an owner.
create or replace function public.org_member_remove(p_org uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare caller text; cur text;
begin
  caller := core._require(p_org, array['owner', 'admin', 'developer', 'viewer']);
  select role into cur from core.memberships where org_id = p_org and user_id = p_user;
  if cur is null then raise exception 'not_a_member' using errcode = 'P0002'; end if;
  if p_user <> auth.uid() then
    if caller not in ('owner', 'admin') or (cur = 'owner' and caller <> 'owner') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  if cur = 'owner' and (select count(*) from core.memberships where org_id = p_org and role = 'owner') <= 1 then
    raise exception 'last_owner' using errcode = '42501';
  end if;
  delete from core.memberships where org_id = p_org and user_id = p_user;
  perform core._log(p_org, case when p_user = auth.uid() then 'member.leave' else 'member.remove' end,
                    p_user::text, jsonb_build_object('role', cur));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- projects and environments ----------
create or replace function public.project_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform core._require(p_org, array['owner', 'admin', 'developer', 'viewer']);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'slug', p.slug, 'created_at', p.created_at,
      'environments', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'slug', e.slug)
                                                 order by e.created_at, e.id)
                                from core.environments e where e.project_id = p.id), '[]'::jsonb))
      order by p.created_at, p.id)
    from core.projects p where p.org_id = p_org), '[]'::jsonb);
end $$;

create or replace function public.project_create(p_org uuid, p_name text, p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n text := btrim(coalesce(p_name, '')); s text := lower(btrim(coalesce(p_slug, ''))); pid uuid;
begin
  perform core._require(p_org, array['owner', 'admin']);
  if char_length(n) not between 1 and 80 or s !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  begin
    insert into core.projects (org_id, name, slug, created_by) values (p_org, n, s, auth.uid()) returning id into pid;
  exception when unique_violation then
    raise exception 'slug_taken' using errcode = '23505';
  end;
  insert into core.environments (project_id, org_id, name, slug)
  values (pid, p_org, 'Production', 'production'), (pid, p_org, 'Development', 'development');
  perform core._log(p_org, 'project.create', s, jsonb_build_object('name', n));
  return jsonb_build_object('id', pid, 'name', n, 'slug', s);
end $$;

create or replace function public.project_delete(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o uuid; s text;
begin
  o := core._project_org(p_project);
  perform core._require(o, array['owner', 'admin']);
  delete from core.projects where id = p_project returning slug into s;
  perform core._log(o, 'project.delete', s, null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.environment_create(p_project uuid, p_name text, p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o uuid; n text := btrim(coalesce(p_name, '')); s text := lower(btrim(coalesce(p_slug, ''))); eid uuid;
begin
  o := core._project_org(p_project);
  perform core._require(o, array['owner', 'admin']);
  if char_length(n) not between 1 and 80 or s !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  begin
    insert into core.environments (project_id, org_id, name, slug) values (p_project, o, n, s) returning id into eid;
  exception when unique_violation then
    raise exception 'slug_taken' using errcode = '23505';
  end;
  perform core._log(o, 'environment.create', s, jsonb_build_object('project_id', p_project));
  return jsonb_build_object('id', eid, 'name', n, 'slug', s);
end $$;

create or replace function public.environment_delete(p_env uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o uuid; pid uuid; s text;
begin
  select org_id, project_id, slug into o, pid, s from core.environments where id = p_env;
  if o is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform core._require(o, array['owner', 'admin']);
  if (select count(*) from core.environments where project_id = pid) <= 1 then
    raise exception 'last_environment' using errcode = '42501';
  end if;
  delete from core.environments where id = p_env;
  perform core._log(o, 'environment.delete', s, jsonb_build_object('project_id', pid));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- audit ----------
create or replace function public.org_audit_list(p_org uuid, p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l int := least(greatest(coalesce(p_limit, 25), 1), 100); o int := greatest(coalesce(p_offset, 0), 0);
begin
  perform core._require(p_org, array['owner', 'admin']);
  return jsonb_build_object(
    'total', (select count(*) from core.audit_log where org_id = p_org),
    'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select id, at, actor_email, action, target, meta from core.audit_log
        where org_id = p_org order by at desc, id desc limit l offset o) x), '[]'::jsonb));
end $$;

-- Lock every RPC to signed-in users (the function bodies then check org role).
do $$
declare f text;
begin
  foreach f in array array[
    'create_organization(text,text)', 'delete_organization(uuid)', 'my_organizations()',
    'org_members(uuid)', 'org_member_add(uuid,text,text)', 'org_member_set_role(uuid,uuid,text)',
    'org_member_remove(uuid,uuid)', 'project_list(uuid)', 'project_create(uuid,text,text)',
    'project_delete(uuid)', 'environment_create(uuid,text,text)', 'environment_delete(uuid)',
    'org_audit_list(uuid,int,int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
