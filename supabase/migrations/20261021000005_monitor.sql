-- Codex Monitor: ingestion keys, events, error groups, usage and abuse limits (Contract A, D, E, F in docs/contracts.md).
--
-- Trust model: an ingestion key belongs to ONE environment, and that is the only source of org, project and environment
-- for an event. The ingest function is callable only by the service role (the Edge Function); browsers read through
-- role-checked functions. Secrets are shown once and stored only as a SHA-256 hash.

create schema if not exists monitor;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'environments_scope_key') then
    alter table core.environments add constraint environments_scope_key unique (id, project_id, org_id);
  end if;
end $$;

create table if not exists monitor.ingestion_keys (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  project_id     uuid not null,
  environment_id uuid not null,
  name           text not null check (char_length(name) between 1 and 80),
  key_prefix     text not null,
  key_hash       bytea not null unique check (octet_length(key_hash) = 32),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  foreign key (environment_id, project_id, org_id) references core.environments (id, project_id, org_id) on delete cascade
);
create index if not exists ingestion_keys_project_idx on monitor.ingestion_keys (project_id);

create table if not exists monitor.events (
  id             bigint generated always as identity primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  environment_id uuid not null,
  event_id       uuid not null,
  type           text not null check (type in ('error', 'custom', 'http', 'log')),
  name           text check (name is null or char_length(name) <= 200),
  severity       text not null check (severity in ('debug', 'info', 'warning', 'error', 'fatal')),
  occurred_at    timestamptz not null,
  received_at    timestamptz not null default now(),
  trace_id       text check (trace_id is null or char_length(trace_id) <= 64),
  span_id        text check (span_id is null or char_length(span_id) <= 64),
  attributes     jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object' and octet_length(attributes::text) <= 32768),
  error_type     text check (error_type is null or char_length(error_type) <= 200),
  error_message  text check (error_message is null or char_length(error_message) <= 2000),
  error_stack    text check (error_stack is null or char_length(error_stack) <= 16000),
  fingerprint    text check (fingerprint is null or char_length(fingerprint) = 64),
  sdk_name       text check (sdk_name is null or char_length(sdk_name) <= 50),
  sdk_version    text check (sdk_version is null or char_length(sdk_version) <= 30),
  sdk_language   text check (sdk_language is null or char_length(sdk_language) <= 30),
  unique (project_id, event_id),
  foreign key (environment_id, project_id, org_id) references core.environments (id, project_id, org_id) on delete cascade
);
create index if not exists events_env_received_idx on monitor.events (environment_id, received_at desc, id desc);
create index if not exists events_project_received_idx on monitor.events (project_id, received_at desc);
create index if not exists events_fingerprint_idx on monitor.events (environment_id, fingerprint, id desc) where fingerprint is not null;

create table if not exists monitor.error_groups (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  project_id        uuid not null,
  environment_id    uuid not null,
  fingerprint       text not null check (char_length(fingerprint) = 64),
  title             text not null check (char_length(title) <= 300),
  first_seen        timestamptz not null,
  last_seen         timestamptz not null,
  event_count       bigint not null default 0,
  status            text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  status_changed_at timestamptz not null default now(),
  unique (environment_id, fingerprint),
  foreign key (environment_id, project_id, org_id) references core.environments (id, project_id, org_id) on delete cascade
);
create index if not exists error_groups_list_idx on monitor.error_groups (project_id, status, last_seen desc);

create table if not exists monitor.usage (
  project_id uuid not null,
  org_id     uuid not null,
  month      date not null,
  accepted   bigint not null default 0,
  primary key (project_id, month),
  foreign key (project_id, org_id) references core.projects (id, org_id) on delete cascade
);

-- Staff-managed override of the monthly event cap. Plans and billing are not built yet, so a default applies.
create table if not exists monitor.project_limits (
  project_id         uuid primary key references core.projects (id) on delete cascade,
  monthly_event_cap  bigint not null check (monthly_event_cap > 0)
);

create table if not exists monitor.rate_counters (
  key_id       uuid not null references monitor.ingestion_keys (id) on delete cascade,
  window_start timestamptz not null,
  events       int not null default 0,
  primary key (key_id, window_start)
);
create table if not exists monitor.auth_failures (
  ip_hash      text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (ip_hash, window_start)
);

-- ---------- permissions ----------
alter table monitor.ingestion_keys enable row level security;
alter table monitor.events         enable row level security;
alter table monitor.error_groups   enable row level security;
alter table monitor.usage          enable row level security;
alter table monitor.project_limits enable row level security;
alter table monitor.rate_counters  enable row level security;
alter table monitor.auth_failures  enable row level security;
revoke all on schema monitor from public, anon, authenticated;
revoke all on all tables in schema monitor from public, anon, authenticated;

-- Defence in depth: members may read their own rows directly. Key hashes are never readable, even by owners.
grant usage on schema monitor to authenticated;
grant select on monitor.events, monitor.error_groups, monitor.usage to authenticated;
grant select (id, org_id, project_id, environment_id, name, key_prefix, created_by, created_at, last_used_at, revoked_at) on monitor.ingestion_keys to authenticated;
drop policy if exists events_select on monitor.events;
create policy events_select on monitor.events for select to authenticated using (core._role(org_id) is not null);
drop policy if exists groups_select on monitor.error_groups;
create policy groups_select on monitor.error_groups for select to authenticated using (core._role(org_id) is not null);
drop policy if exists usage_select on monitor.usage;
create policy usage_select on monitor.usage for select to authenticated using (core._role(org_id) in ('owner', 'admin'));
drop policy if exists keys_select on monitor.ingestion_keys;
create policy keys_select on monitor.ingestion_keys for select to authenticated using (core._role(org_id) in ('owner', 'admin', 'developer'));

-- ---------- internal helpers ----------
create or replace function monitor._cap(p_project uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select monthly_event_cap from monitor.project_limits where project_id = p_project), 100000)
$$;
revoke all on function monitor._cap(uuid) from public, anon, authenticated;

-- ---------- ingestion (service role only) ----------
-- Returns {ok:true, accepted, duplicates} or {ok:false, error}. Expected failures are RETURNED, not raised, so the
-- failure counters they update are kept. Org, project and environment come from the key, never from the payload.
create or replace function public.ingest_events(p_key_hash bytea, p_ip_hash text, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k monitor.ingestion_keys;
  n int;
  w_min timestamptz := to_timestamp(floor(extract(epoch from now()) / 60) * 60);
  w_fail timestamptz := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  v_month date := (date_trunc('month', now() at time zone 'utc'))::date;
  used bigint; cap bigint; v_acc int; v_hits int; per_min int;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 100 then
    return jsonb_build_object('ok', false, 'error', 'invalid_event');
  end if;
  n := jsonb_array_length(p_events);

  if random() < 0.02 then
    delete from monitor.auth_failures where window_start < now() - interval '2 days';
    delete from monitor.rate_counters where window_start < now() - interval '2 days';
  end if;

  if p_ip_hash is not null then
    select coalesce(sum(f.hits), 0) into v_hits from monitor.auth_failures f where f.ip_hash = p_ip_hash and f.window_start >= w_fail - interval '10 minutes';
    if v_hits >= 30 then return jsonb_build_object('ok', false, 'error', 'rate_limited'); end if;
  end if;

  select * into k from monitor.ingestion_keys where key_hash = p_key_hash and revoked_at is null;
  if not found then
    if p_ip_hash is not null then
      insert into monitor.auth_failures as f (ip_hash, window_start, hits) values (p_ip_hash, w_fail, 1)
      on conflict (ip_hash, window_start) do update set hits = f.hits + 1;
    end if;
    return jsonb_build_object('ok', false, 'error', 'invalid_key');
  end if;

  insert into monitor.rate_counters as r (key_id, window_start, events) values (k.id, w_min, n)
  on conflict (key_id, window_start) do update set events = r.events + n
  returning r.events into per_min;
  if per_min > 6000 then return jsonb_build_object('ok', false, 'error', 'rate_limited'); end if;

  cap := monitor._cap(k.project_id);
  select coalesce((select u.accepted from monitor.usage u where u.project_id = k.project_id and u.month = v_month), 0) into used;
  if used + n > cap then return jsonb_build_object('ok', false, 'error', 'quota_exceeded'); end if;

  with ins as (
    insert into monitor.events (org_id, project_id, environment_id, event_id, type, name, severity, occurred_at, trace_id, span_id,
                                attributes, error_type, error_message, error_stack, fingerprint, sdk_name, sdk_version, sdk_language)
    select k.org_id, k.project_id, k.environment_id, (e ->> 'event_id')::uuid, e ->> 'type', e ->> 'name', e ->> 'severity',
           (e ->> 'occurred_at')::timestamptz, e ->> 'trace_id', e ->> 'span_id', coalesce(e -> 'attributes', '{}'::jsonb),
           e #>> '{error,type}', e #>> '{error,message}', e #>> '{error,stack}', e ->> 'fingerprint',
           e #>> '{sdk,name}', e #>> '{sdk,version}', e #>> '{sdk,language}'
    from jsonb_array_elements(p_events) e
    on conflict (project_id, event_id) do nothing
    returning type, fingerprint, error_type, error_message, occurred_at
  ), grp as (
    insert into monitor.error_groups as g (org_id, project_id, environment_id, fingerprint, title, first_seen, last_seen, event_count)
    select k.org_id, k.project_id, k.environment_id, i.fingerprint,
           left(coalesce((array_agg(i.error_type order by i.occurred_at))[1], 'Error')
                || coalesce(': ' || nullif(split_part((array_agg(i.error_message order by i.occurred_at))[1], E'\n', 1), ''), ''), 300),
           min(i.occurred_at), max(i.occurred_at), count(*)
    from ins i where i.type = 'error' and i.fingerprint is not null group by i.fingerprint
    on conflict (environment_id, fingerprint) do update set
      last_seen = greatest(g.last_seen, excluded.last_seen),
      first_seen = least(g.first_seen, excluded.first_seen),
      event_count = g.event_count + excluded.event_count,
      status = case when g.status = 'resolved' then 'open' else g.status end,
      status_changed_at = case when g.status = 'resolved' then now() else g.status_changed_at end
    returning 1
  )
  select count(*) into v_acc from ins;

  if v_acc > 0 then
    insert into monitor.usage as u (project_id, org_id, month, accepted) values (k.project_id, k.org_id, v_month, v_acc)
    on conflict (project_id, month) do update set accepted = u.accepted + excluded.accepted;
  end if;
  update monitor.ingestion_keys set last_used_at = now() where id = k.id;
  return jsonb_build_object('ok', true, 'accepted', v_acc, 'duplicates', n - v_acc);
end $$;
revoke all on function public.ingest_events(bytea, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_events(bytea, text, jsonb) to service_role;

-- ---------- ingestion keys (owner, admin, developer) ----------
create or replace function public.ingestion_key_create(p_environment uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e core.environments; n text := btrim(coalesce(p_name, '')); secret text; kid uuid;
begin
  select * into e from core.environments where id = p_environment;
  if e.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform core._require(e.org_id, array['owner', 'admin', 'developer']);
  if char_length(n) not between 1 and 80 then raise exception 'invalid_input' using errcode = '22023'; end if;
  if (select count(*) from monitor.ingestion_keys where environment_id = e.id and revoked_at is null) >= 10 then
    raise exception 'too_many_keys' using errcode = '53400';
  end if;
  secret := 'cdx_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into monitor.ingestion_keys (org_id, project_id, environment_id, name, key_prefix, key_hash, created_by)
  values (e.org_id, e.project_id, e.id, n, left(secret, 12), sha256(convert_to(secret, 'UTF8')), auth.uid())
  returning id into kid;
  perform core._log(e.org_id, 'key.create', left(secret, 12), jsonb_build_object('environment_id', e.id, 'name', n));
  return jsonb_build_object('id', kid, 'name', n, 'environment_id', e.id, 'prefix', left(secret, 12), 'key', secret);
end $$;

create or replace function public.ingestion_key_revoke(p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k monitor.ingestion_keys;
begin
  select * into k from monitor.ingestion_keys where id = p_key;
  if k.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform core._require(k.org_id, array['owner', 'admin', 'developer']);
  update monitor.ingestion_keys set revoked_at = coalesce(revoked_at, now()) where id = p_key;
  perform core._log(k.org_id, 'key.revoke', k.key_prefix, jsonb_build_object('environment_id', k.environment_id));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ingestion_keys_list(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o uuid;
begin
  o := core._project_org(p_project);
  perform core._require(o, array['owner', 'admin', 'developer']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'prefix', k.key_prefix, 'environment_id', k.environment_id,
            'environment', e.name, 'created_at', k.created_at, 'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at)
            order by k.revoked_at is not null, k.created_at desc, k.id)
          from monitor.ingestion_keys k join core.environments e on e.id = k.environment_id where k.project_id = p_project), '[]'::jsonb);
end $$;

-- ---------- reads (every member) ----------
create or replace function public.monitor_overview(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o uuid; keys int; last_ts timestamptz; v_month date := (date_trunc('month', now() at time zone 'utc'))::date; state text; reason text;
begin
  o := core._project_org(p_project);
  perform core._require(o, array['owner', 'admin', 'developer', 'viewer']);
  select count(*) into keys from monitor.ingestion_keys where project_id = p_project and revoked_at is null;
  select max(received_at) into last_ts from monitor.events where project_id = p_project;
  -- Contract D, derived on read: connected only after a real event has arrived; silence for 24 hours degrades it.
  if keys = 0 then state := 'setup_required'; reason := 'Create an ingestion key.';
  elsif last_ts is null then state := 'verifying'; reason := 'Waiting for the first event.';
  elsif last_ts > now() - interval '24 hours' then state := 'connected'; reason := null;
  else state := 'degraded'; reason := 'No events received in the last 24 hours.'; end if;
  return jsonb_build_object(
    'capability', jsonb_build_object('state', state, 'reason', reason, 'last_success_at', last_ts, 'active_keys', keys),
    'events_24h', (select count(*) from monitor.events where project_id = p_project and received_at > now() - interval '24 hours'),
    'open_groups', (select count(*) from monitor.error_groups where project_id = p_project and status = 'open'),
    'new_groups_24h', (select count(*) from monitor.error_groups where project_id = p_project and first_seen > now() - interval '24 hours'),
    'usage_month', coalesce((select accepted from monitor.usage where project_id = p_project and monitor.usage.month = v_month), 0),
    'monthly_cap', monitor._cap(p_project),
    'hourly', coalesce((select jsonb_agg(c order by h) from (
        select g.h, (select count(*) from monitor.events ev where ev.project_id = p_project and ev.received_at >= g.h and ev.received_at < g.h + interval '1 hour') c
        from generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') g(h)) x), '[]'::jsonb));
end $$;

create or replace function public.error_groups_list(p_project uuid, p_env uuid default null, p_status text default null,
                                                    p_search text default null, p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o uuid; l int := least(greatest(coalesce(p_limit, 25), 1), 100); off int := greatest(coalesce(p_offset, 0), 0);
        s text := nullif(btrim(coalesce(p_search, '')), ''); pat text;
begin
  o := core._project_org(p_project);
  perform core._require(o, array['owner', 'admin', 'developer', 'viewer']);
  if p_status is not null and p_status not in ('open', 'resolved', 'ignored') then raise exception 'invalid_input' using errcode = '22023'; end if;
  pat := case when s is null then null else '%' || replace(replace(replace(left(s, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  return jsonb_build_object(
    'total', (select count(*) from monitor.error_groups g where g.project_id = p_project and (p_env is null or g.environment_id = p_env)
                and (p_status is null or g.status = p_status) and (pat is null or g.title ilike pat escape '\')),
    'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select g.id, g.title, g.status, g.event_count, g.first_seen, g.last_seen, g.environment_id, e.name as environment
        from monitor.error_groups g join core.environments e on e.id = g.environment_id
        where g.project_id = p_project and (p_env is null or g.environment_id = p_env) and (p_status is null or g.status = p_status)
          and (pat is null or g.title ilike pat escape '\')
        order by g.last_seen desc, g.id limit l offset off) x), '[]'::jsonb));
end $$;

create or replace function public.error_group_get(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g monitor.error_groups;
begin
  select * into g from monitor.error_groups where id = p_group;
  if g.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform core._require(g.org_id, array['owner', 'admin', 'developer', 'viewer']);
  return jsonb_build_object(
    'group', jsonb_build_object('id', g.id, 'title', g.title, 'status', g.status, 'event_count', g.event_count, 'first_seen', g.first_seen,
              'last_seen', g.last_seen, 'environment_id', g.environment_id,
              'environment', (select name from core.environments where id = g.environment_id)),
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select ev.id, ev.event_id, ev.occurred_at, ev.severity, ev.error_type, ev.error_message, ev.error_stack, ev.trace_id,
               ev.attributes, ev.sdk_name, ev.sdk_version
        from monitor.events ev where ev.environment_id = g.environment_id and ev.fingerprint = g.fingerprint
        order by ev.id desc limit 20) x), '[]'::jsonb));
end $$;

create or replace function public.error_group_set_status(p_group uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g monitor.error_groups;
begin
  select * into g from monitor.error_groups where id = p_group;
  if g.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform core._require(g.org_id, array['owner', 'admin', 'developer']);
  if p_status is null or p_status not in ('open', 'resolved', 'ignored') then raise exception 'invalid_input' using errcode = '22023'; end if;
  update monitor.error_groups set status = p_status, status_changed_at = now() where id = p_group;
  perform core._log(g.org_id, 'error.set_status', p_group::text, jsonb_build_object('from', g.status, 'to', p_status));
  return jsonb_build_object('id', p_group, 'status', p_status);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'ingestion_key_create(uuid,text)', 'ingestion_key_revoke(uuid)', 'ingestion_keys_list(uuid)', 'monitor_overview(uuid)',
    'error_groups_list(uuid,uuid,text,text,int,int)', 'error_group_get(uuid)', 'error_group_set_status(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
