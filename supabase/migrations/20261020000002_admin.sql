-- Codex admin console schema and RPCs. Requires 20261020000001_waitlist.sql first.
-- Move into codex-tech-developers-platform/supabase/migrations when that repo exists.
-- Run once in the Supabase SQL Editor.

create schema if not exists admin;

create table if not exists admin.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('super_admin', 'admin', 'viewer')),
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists admin.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null,
  target      text,
  meta        jsonb
);
create index if not exists audit_log_at_idx on admin.audit_log (at desc);

-- Nothing here is reachable directly from the browser. Only the RPCs below, which check the caller's role.
alter table admin.admins enable row level security;
alter table admin.audit_log enable row level security;
revoke all on schema admin from anon, authenticated;
revoke all on all tables in schema admin from anon, authenticated;

-- ---------- internal helpers (schema admin is not exposed) ----------
create or replace function admin._role() returns text
language sql stable security definer set search_path = '' as $$
  select role from admin.admins where user_id = auth.uid()
$$;

create or replace function admin._require(p_roles text[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r text;
begin
  r := admin._role();
  if auth.uid() is null or r is null or not (r = any (p_roles)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return r;
end $$;

create or replace function admin._log(p_action text, p_target text, p_meta jsonb default null) returns void
language sql security definer set search_path = '' as $$
  insert into admin.audit_log (actor_id, actor_email, action, target, meta)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), p_action, p_target, p_meta)
$$;

revoke all on function admin._role() from public, anon, authenticated;
revoke all on function admin._require(text[]) from public, anon, authenticated;
revoke all on function admin._log(text, text, jsonb) from public, anon, authenticated;

-- ---------- RPCs called by the admin app (authenticated users with an admin role only) ----------
create or replace function public.admin_me() returns text
language sql stable security definer set search_path = '' as $$
  select admin._role()
$$;

create or replace function public.admin_waitlist_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform admin._require(array['super_admin', 'admin', 'viewer']);
  return jsonb_build_object(
    'total',    (select count(*) from waitlist.signups),
    'today',    (select count(*) from waitlist.signups where created_at >= date_trunc('day', now())),
    'last7',    (select count(*) from waitlist.signups where created_at >= now() - interval '7 days'),
    'removals', (select count(*) from waitlist.signups where status = 'removal_requested'),
    'by_language', (select coalesce(jsonb_object_agg(language, c), '{}'::jsonb)
                    from (select language, count(*) c from waitlist.signups group by 1) t),
    'by_provider', (select coalesce(jsonb_object_agg(payment_provider, c), '{}'::jsonb)
                    from (select payment_provider, count(*) c from waitlist.signups group by 1) t),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'count', coalesce(s.c, 0)) order by d), '[]'::jsonb)
              from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d
              left join (select date_trunc('day', created_at) as day, count(*) c from waitlist.signups group by 1) s on s.day = d)
  );
end $$;

create or replace function public.admin_waitlist_list(
  p_search text default null, p_language text default null, p_provider text default null,
  p_status text default null, p_limit int default 25, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l int := least(greatest(coalesce(p_limit, 25), 1), 1000);
  o int := greatest(coalesce(p_offset, 0), 0);
  pat text := '%' || replace(replace(replace(coalesce(p_search, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  res jsonb;
begin
  perform admin._require(array['super_admin', 'admin', 'viewer']);
  with f as (
    select * from waitlist.signups s
    where (coalesce(p_search, '') = '' or s.email ilike pat)
      and (coalesce(p_language, '') = '' or s.language = p_language)
      and (coalesce(p_provider, '') = '' or s.payment_provider = p_provider)
      and (coalesce(p_status, '') = '' or s.status = p_status)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id)
      from (select id, email, language, payment_provider, note, status, created_at
            from f order by created_at desc, id limit l offset o) x), '[]'::jsonb)
  ) into res;
  return res;
end $$;

create or replace function public.admin_waitlist_set_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  perform admin._require(array['super_admin', 'admin']);
  if p_status not in ('new', 'invited', 'removal_requested') then raise exception 'invalid_status'; end if;
  update waitlist.signups set status = p_status where id = p_id returning email into v_email;
  if v_email is null then raise exception 'not_found'; end if;
  perform admin._log('waitlist.status', v_email, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_waitlist_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  perform admin._require(array['super_admin', 'admin']);
  delete from waitlist.signups where id = p_id returning email into v_email;
  if v_email is null then raise exception 'not_found'; end if;
  perform admin._log('waitlist.delete', v_email, null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_log_export(p_count int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform admin._require(array['super_admin', 'admin']);
  perform admin._log('waitlist.export', coalesce(p_count, 0)::text || ' rows', null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_team_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform admin._require(array['super_admin']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'email', u.email, 'role', a.role, 'created_at', a.created_at,
                     'last_sign_in_at', u.last_sign_in_at) order by a.created_at)
    from admin.admins a join auth.users u on u.id = a.user_id), '[]'::jsonb);
end $$;

create or replace function public.admin_team_add(p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform admin._require(array['super_admin']);
  if p_role not in ('super_admin', 'admin', 'viewer') then raise exception 'invalid_role'; end if;
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_id is null then raise exception 'user_not_found'; end if;
  insert into admin.admins (user_id, role, created_by) values (v_id, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role;
  perform admin._log('team.add', lower(btrim(p_email)), jsonb_build_object('role', p_role));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_team_set_role(p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  perform admin._require(array['super_admin']);
  if p_role not in ('super_admin', 'admin', 'viewer') then raise exception 'invalid_role'; end if;
  if p_user = auth.uid() then raise exception 'cannot_change_self'; end if;
  update admin.admins set role = p_role where user_id = p_user;
  if not found then raise exception 'not_found'; end if;
  select email into v_email from auth.users where id = p_user;
  perform admin._log('team.role', v_email, jsonb_build_object('role', p_role));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_team_remove(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  perform admin._require(array['super_admin']);
  if p_user = auth.uid() then raise exception 'cannot_remove_self'; end if;
  delete from admin.admins where user_id = p_user;
  if not found then raise exception 'not_found'; end if;
  select email into v_email from auth.users where id = p_user;
  perform admin._log('team.remove', v_email, null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_audit_list(p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  l int := least(greatest(coalesce(p_limit, 25), 1), 200);
  o int := greatest(coalesce(p_offset, 0), 0);
begin
  perform admin._require(array['super_admin', 'admin']);
  return jsonb_build_object(
    'total', (select count(*) from admin.audit_log),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.id desc)
             from (select id, at, actor_email, action, target, meta from admin.audit_log
                   order by at desc, id desc limit l offset o) x), '[]'::jsonb));
end $$;

-- Lock every RPC to signed-in users (the function bodies then check the admin role).
do $$
declare f text;
begin
  foreach f in array array[
    'admin_me()', 'admin_waitlist_stats()', 'admin_waitlist_list(text,text,text,text,int,int)',
    'admin_waitlist_set_status(uuid,text)', 'admin_waitlist_delete(uuid)', 'admin_log_export(int)',
    'admin_team_list()', 'admin_team_add(text,text)', 'admin_team_set_role(uuid,text)',
    'admin_team_remove(uuid)', 'admin_audit_list(int,int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
