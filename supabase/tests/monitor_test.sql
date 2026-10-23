-- Monitor tests: ingestion keys, ingest function, abuse limits, error groups, reads, tenant isolation. LOCAL throwaway Postgres only.
-- Reuses the t.* helpers created by core_isolation_test.sql.
\set ON_ERROR_STOP on

create function t.ev(p_id uuid default gen_random_uuid(), p_type text default 'custom', p_fp text default null, p_msg text default 'boom') returns jsonb
language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('event_id', p_id, 'type', p_type, 'severity', 'error', 'occurred_at', now(), 'name', 'n',
    'attributes', '{"a":1}'::jsonb, 'fingerprint', p_fp,
    'error', case when p_type = 'error' then jsonb_build_object('type', 'TypeError', 'message', p_msg, 'stack', E'TypeError: x\n    at f (a.ts:1:1)') end))
$$;
grant execute on function t.ev(uuid, text, text, text) to public;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000000011', 'm-owner@x.com'), ('00000000-0000-0000-0000-000000000012', 'm-dev@x.com'),
 ('00000000-0000-0000-0000-000000000013', 'm-viewer@x.com'), ('00000000-0000-0000-0000-000000000014', 'x-owner@x.com'),
 ('00000000-0000-0000-0000-000000000015', 'm-admin@x.com');
\set o '00000000-0000-0000-0000-000000000011'
\set d '00000000-0000-0000-0000-000000000012'
\set v '00000000-0000-0000-0000-000000000013'
\set x '00000000-0000-0000-0000-000000000014'
\set a '00000000-0000-0000-0000-000000000015'
\set fpa `printf 'a%.0s' $(seq 1 64)`
\set fpb `printf 'b%.0s' $(seq 1 64)`

-- ===== setup =====
set role authenticated;
select set_config('request.jwt.claim.sub', :'o', false);
select (public.create_organization('Mon', 'mon')->>'id') as org \gset
select (public.project_create(:'org', 'Svc', 'svc')->>'id') as proj \gset
select public.org_member_add(:'org', 'm-dev@x.com', 'developer');
select public.org_member_add(:'org', 'm-viewer@x.com', 'viewer');
select public.org_member_add(:'org', 'm-admin@x.com', 'admin');
select e->>'id' as envp from jsonb_array_elements(public.project_list(:'org')->0->'environments') e where e->>'slug' = 'production' \gset
select e->>'id' as envd from jsonb_array_elements(public.project_list(:'org')->0->'environments') e where e->>'slug' = 'development' \gset
select set_config('request.jwt.claim.sub', :'x', false);
select (public.create_organization('Other', 'other')->>'id') as orgx \gset
select (public.project_create(:'orgx', 'Their', 'their')->>'id') as projx \gset
select e->>'id' as envx from jsonb_array_elements(public.project_list(:'orgx')->0->'environments') e limit 1 \gset
select (public.ingestion_key_create(:'envx', 'theirs')->>'key') as keyx \gset

-- ===== ingestion keys =====
select set_config('request.jwt.claim.sub', :'o', false);
select (public.ingestion_key_create(:'envp', 'prod')->>'key') as keyp \gset
select (public.ingestion_key_create(:'envd', 'dev')->>'key') as keyd \gset
select t.eq('key has the cdx_ prefix and 68 characters', (:'keyp' like 'cdx_%' and char_length(:'keyp') = 68)::text, 'true');
reset role;
select t.eq('only the SHA-256 hash is stored', (select count(*) from monitor.ingestion_keys where key_hash = sha256(convert_to(:'keyp', 'UTF8')))::text, '1');
select t.eq('the secret is stored nowhere in the table', (select count(*) from monitor.ingestion_keys k where k::text like '%' || :'keyp' || '%')::text, '0');
select t.eq('the secret is not in the audit log', (select count(*) from core.audit_log a where a::text like '%' || :'keyp' || '%')::text, '0');
select t.eq('key creation is audited', (select count(*) from core.audit_log where org_id = :'org' and action = 'key.create')::text, '2');
set role authenticated;
select t.throws('browser role cannot read key hashes', 'select key_hash from monitor.ingestion_keys', '42501');
select t.eq('owner can read key metadata directly', (select count(*) from monitor.ingestion_keys)::text, '2');
select t.eq('listing never includes the hash or secret', (public.ingestion_keys_list(:'proj')::text like '%key_hash%' or public.ingestion_keys_list(:'proj')::text like '%' || :'keyp' || '%')::text, 'false');
select t.eq('list shows both keys', jsonb_array_length(public.ingestion_keys_list(:'proj'))::text, '2');
select t.throws('invalid key name rejected', format('select public.ingestion_key_create(%L, %L)', :'envp', '  '), 'invalid_input');

select set_config('request.jwt.claim.sub', :'d', false);
select t.check('developer can create keys', (public.ingestion_key_create(:'envd', 'dev-2')->>'key') like 'cdx_%');
select t.eq('developer can list keys', jsonb_array_length(public.ingestion_keys_list(:'proj'))::text, '3');
select set_config('request.jwt.claim.sub', :'v', false);
select t.throws('viewer cannot create keys', format('select public.ingestion_key_create(%L, %L)', :'envp', 'x'), 'forbidden');
select t.throws('viewer cannot list keys', format('select public.ingestion_keys_list(%L)', :'proj'), 'forbidden');
select t.eq('viewer sees no key rows (rls)', (select count(*) from monitor.ingestion_keys)::text, '0');
select set_config('request.jwt.claim.sub', :'x', false);
select t.throws('outsider cannot create a key for our environment', format('select public.ingestion_key_create(%L, %L)', :'envp', 'x'), 'forbidden');
select t.throws('outsider cannot list our keys', format('select public.ingestion_keys_list(%L)', :'proj'), 'forbidden');
select t.eq('outsider sees only their own key rows', (select count(*) from monitor.ingestion_keys)::text, '1');
select t.throws('unknown environment looks the same', format('select public.ingestion_key_create(%L, %L)', '00000000-0000-0000-0000-0000000000ff', 'x'), 'forbidden');
select (select k->>'id' from jsonb_array_elements(public.ingestion_keys_list(:'projx')) k limit 1) as keyx_id \gset
select set_config('request.jwt.claim.sub', :'o', false);
select t.throws('cannot revoke another org key', format('select public.ingestion_key_revoke(%L)', :'keyx_id'), 'forbidden');

-- ===== ingest: happy path and tenant scoping =====
reset role; set role service_role;
select public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-1', jsonb_build_array(
  t.ev(gen_random_uuid(), 'custom'), (t.ev(gen_random_uuid(), 'error', :'fpa') || jsonb_build_object('org_id', :'orgx', 'project_id', :'projx', 'environment_id', :'envx')))) as r1 \gset
select t.eq('batch accepted', :'r1'::jsonb->>'accepted', '2');
reset role;
select t.eq('events land in the key''s environment', (select count(*) from monitor.events where environment_id = :'envp' and project_id = :'proj' and org_id = :'org')::text, '2');
select t.eq('payload cannot redirect events to another tenant', (select count(*) from monitor.events where org_id = :'orgx')::text, '0');
select t.eq('usage counted', (select accepted from monitor.usage where project_id = :'proj')::text, '2');
select t.check('key last_used_at is set', (select last_used_at is not null from monitor.ingestion_keys where key_hash = sha256(convert_to(:'keyp', 'UTF8'))));
select t.eq('error event created a group', (select count(*) from monitor.error_groups where project_id = :'proj' and environment_id = :'envp')::text, '1');
select t.eq('group title is type and first message line', (select title from monitor.error_groups where project_id = :'proj'), 'TypeError: boom');

-- dev-environment key writes to the dev environment only
set role service_role;
select public.ingest_events(sha256(convert_to(:'keyd', 'UTF8')), 'ip-1', jsonb_build_array(t.ev())) as r2 \gset
reset role;
select t.eq('dev key writes only to development', (select count(*) from monitor.events where environment_id = :'envd')::text, '1');

-- duplicates are accepted once and not double counted
set role service_role;
select gen_random_uuid() as dupid \gset
select public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-1', jsonb_build_array(t.ev(:'dupid'))) as r3 \gset
select public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-1', jsonb_build_array(t.ev(:'dupid'))) as r4 \gset
select t.eq('first send accepted', :'r3'::jsonb->>'accepted', '1');
select t.eq('repeat send is a duplicate', :'r4'::jsonb->>'duplicates', '1');
select t.eq('repeat send accepts nothing', :'r4'::jsonb->>'accepted', '0');
reset role;
select t.eq('usage not double counted', (select accepted from monitor.usage where project_id = :'proj')::text, '4');

-- ===== ingest: bad input and bad keys =====
set role service_role;
select t.eq('empty batch rejected', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-1', '[]'::jsonb)->>'error', 'invalid_event');
select t.eq('non-array rejected', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-1', '{"a":1}'::jsonb)->>'error', 'invalid_event');
select t.eq('101 events rejected', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-1', (select jsonb_agg(t.ev()) from generate_series(1, 101)))->>'error', 'invalid_event');
select t.eq('100 events accepted', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-1', (select jsonb_agg(t.ev()) from generate_series(1, 100)))->>'accepted', '100');
select t.throws('malformed event id is refused by the database', format('select public.ingest_events(sha256(convert_to(%L, %L)), %L, %L::jsonb)', :'keyp', 'UTF8', 'ip-1', '[{"event_id":"nope","type":"custom","severity":"info","occurred_at":"2026-01-01T00:00:00Z"}]'), '22P02');
select t.throws('bad severity is refused by the database', format('select public.ingest_events(sha256(convert_to(%L, %L)), %L, %L::jsonb)', :'keyp', 'UTF8', 'ip-1', '[{"event_id":"' || gen_random_uuid() || '","type":"custom","severity":"loud","occurred_at":"2026-01-01T00:00:00Z"}]'), '23514');
select t.eq('unknown key rejected', public.ingest_events(sha256(convert_to('cdx_nope', 'UTF8')), 'ip-2', jsonb_build_array(t.ev()))->>'error', 'invalid_key');
select t.eq('null hash rejected', public.ingest_events(null, 'ip-2', jsonb_build_array(t.ev()))->>'error', 'invalid_key');

-- revoked keys stop working
reset role; set role authenticated; select set_config('request.jwt.claim.sub', :'d', false);
select (select k->>'id' from jsonb_array_elements(public.ingestion_keys_list(:'proj')) k where k->>'name' = 'dev-2') as revid \gset
select public.ingestion_key_revoke(:'revid');
select set_config('request.jwt.claim.sub', :'o', false);
select t.eq('revoking is audited', (select count(*) from core.audit_log where org_id = :'org' and action = 'key.revoke')::text, '1');
-- a freshly created and revoked key is rejected
select (public.ingestion_key_create(:'envp', 'temp')->>'key') as keyt \gset
select (select k->>'id' from jsonb_array_elements(public.ingestion_keys_list(:'proj')) k where k->>'name' = 'temp') as tid \gset
select public.ingestion_key_revoke(:'tid');
reset role; set role service_role;
select t.eq('revoked key rejected', public.ingest_events(sha256(convert_to(:'keyt', 'UTF8')), 'ip-3', jsonb_build_array(t.ev()))->>'error', 'invalid_key');
select t.eq('other keys unaffected by a revoke', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-3', jsonb_build_array(t.ev()))->>'ok', 'true');

-- ===== abuse limits =====
-- failed attempts from one client are throttled, even if it later presents a valid key
do $$ begin for i in 1..30 loop perform public.ingest_events(sha256(convert_to('cdx_guess' || i, 'UTF8')), 'ip-bad', jsonb_build_array(t.ev())); end loop; end $$;
select t.eq('after 30 bad keys the client is limited', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-bad', jsonb_build_array(t.ev()))->>'error', 'rate_limited');
select t.eq('other clients are unaffected', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-good', jsonb_build_array(t.ev()))->>'ok', 'true');
-- per-key rate limit
reset role;
update monitor.rate_counters set events = 6000;
set role service_role;
select t.eq('per-key rate limit applies', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-good', jsonb_build_array(t.ev()))->>'error', 'rate_limited');
reset role;
delete from monitor.rate_counters;
-- monthly quota: the whole batch is refused, nothing partially stored
insert into monitor.project_limits values (:'proj', (select accepted from monitor.usage where project_id = :'proj') + 2);
set role service_role;
select t.eq('batch over the cap is refused', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-good', jsonb_build_array(t.ev(), t.ev(), t.ev()))->>'error', 'quota_exceeded');
reset role;
select t.eq('refused batch stored nothing', (select accepted from monitor.usage where project_id = :'proj')::text, (select (monthly_event_cap - 2)::text from monitor.project_limits where project_id = :'proj'));
set role service_role;
select t.eq('batch within the cap is accepted', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-good', jsonb_build_array(t.ev(), t.ev()))->>'accepted', '2');
select t.eq('then the cap holds', public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-good', jsonb_build_array(t.ev()))->>'error', 'quota_exceeded');
reset role;
delete from monitor.project_limits;

-- ===== grouping and status =====
set role service_role;
select public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-g', jsonb_build_array(t.ev(gen_random_uuid(), 'error', :'fpa'), t.ev(gen_random_uuid(), 'error', :'fpa'), t.ev(gen_random_uuid(), 'error', :'fpb', 'other failure')));
reset role;
select t.eq('same fingerprint forms one group', (select event_count from monitor.error_groups where fingerprint = :'fpa')::text, '3');
select t.eq('different fingerprint forms another', (select count(*) from monitor.error_groups where project_id = :'proj')::text, '2');
select id as ga from monitor.error_groups where fingerprint = :'fpa' \gset
select id as gb from monitor.error_groups where fingerprint = :'fpb' \gset

set role authenticated; select set_config('request.jwt.claim.sub', :'d', false);
select t.eq('developer resolves a group', public.error_group_set_status(:'ga', 'resolved')->>'status', 'resolved');
select t.throws('invalid status rejected', format('select public.error_group_set_status(%L, %L)', :'ga', 'wontfix'), 'invalid_input');
select public.error_group_set_status(:'gb', 'ignored');
select set_config('request.jwt.claim.sub', :'v', false);
select t.throws('viewer cannot change status', format('select public.error_group_set_status(%L, %L)', :'ga', 'open'), 'forbidden');
select set_config('request.jwt.claim.sub', :'x', false);
select t.throws('outsider cannot change status', format('select public.error_group_set_status(%L, %L)', :'ga', 'open'), 'forbidden');
reset role; set role service_role;
select public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-g', jsonb_build_array(t.ev(gen_random_uuid(), 'error', :'fpa'), t.ev(gen_random_uuid(), 'error', :'fpb', 'other failure')));
reset role;
select t.eq('a resolved group reopens on a new event', (select status from monitor.error_groups where id = :'ga'), 'open');
select t.eq('an ignored group stays ignored', (select status from monitor.error_groups where id = :'gb'), 'ignored');

-- the group title comes from the earliest event in the batch, not an arbitrary one
set role service_role;
select public.ingest_events(sha256(convert_to(:'keyp', 'UTF8')), 'ip-g', jsonb_build_array(
  t.ev(gen_random_uuid(), 'error', repeat('c', 64), 'zzz first') || jsonb_build_object('occurred_at', now() - interval '1 hour'),
  t.ev(gen_random_uuid(), 'error', repeat('c', 64), 'aaa second')));
reset role;
select t.eq('group title uses the earliest message', (select title from monitor.error_groups where fingerprint = repeat('c', 64)), 'TypeError: zzz first');

-- ===== reads and isolation =====
set role authenticated; select set_config('request.jwt.claim.sub', :'v', false);
select t.eq('viewer lists groups', (public.error_groups_list(:'proj')->>'total'), '3');
select t.eq('viewer opens a group', public.error_group_get(:'ga')->'group'->>'status', 'open');
select t.check('group detail includes events with stacks', jsonb_array_length(public.error_group_get(:'ga')->'events') >= 1 and public.error_group_get(:'ga')->'events'->0->>'error_stack' is not null);
select t.eq('viewer reads the overview', jsonb_typeof(public.monitor_overview(:'proj')->'capability'), 'object');
select t.eq('filter by status', (public.error_groups_list(:'proj', null, 'ignored')->>'total'), '1');
select t.eq('filter by environment', (public.error_groups_list(:'proj', :'envd')->>'total'), '0');
select t.eq('search by title', (public.error_groups_list(:'proj', null, null, 'other fail')->>'total'), '1');
select t.eq('search treats % as a literal', (public.error_groups_list(:'proj', null, null, '%')->>'total'), '0');
select t.eq('pagination limit', jsonb_array_length(public.error_groups_list(:'proj', null, null, null, 1, 0)->'rows')::text, '1');
select t.throws('invalid status filter rejected', format('select public.error_groups_list(%L, null, %L)', :'proj', 'bogus'), 'invalid_input');
select t.eq('viewer sees events by rls', ((select count(*) from monitor.events) > 0)::text, 'true');
select t.eq('viewer sees no usage rows (owners and admins only)', (select count(*) from monitor.usage)::text, '0');
select set_config('request.jwt.claim.sub', :'x', false);
select t.throws('outsider cannot list our groups', format('select public.error_groups_list(%L)', :'proj'), 'forbidden');
select t.throws('outsider cannot open our group', format('select public.error_group_get(%L)', :'ga'), 'forbidden');
select t.throws('outsider cannot read our overview', format('select public.monitor_overview(%L)', :'proj'), 'forbidden');
select t.eq('outsider sees none of our events', (select count(*) from monitor.events where org_id = :'org')::text, '0');
select t.eq('outsider sees none of our groups', (select count(*) from monitor.error_groups where org_id = :'org')::text, '0');
select t.eq('outsider own data intact', (public.error_groups_list(:'projx')->>'total'), '0');

-- ===== capability states (Contract D, derived) =====
select set_config('request.jwt.claim.sub', :'x', false);
select t.eq('outsider project with a key and no events is verifying', public.monitor_overview(:'projx')->'capability'->>'state', 'verifying');
select set_config('request.jwt.claim.sub', :'o', false);
select t.eq('project with events is connected', public.monitor_overview(:'proj')->'capability'->>'state', 'connected');
reset role;
update monitor.events set received_at = now() - interval '2 days' where project_id = :'proj';
set role authenticated; select set_config('request.jwt.claim.sub', :'o', false);
select t.eq('two days of silence degrades it', public.monitor_overview(:'proj')->'capability'->>'state', 'degraded');
reset role; update monitor.ingestion_keys set revoked_at = now() where project_id = :'proj';
set role authenticated; select set_config('request.jwt.claim.sub', :'o', false);
select t.eq('no active key means setup required', public.monitor_overview(:'proj')->'capability'->>'state', 'setup_required');
select t.eq('overview has 24 hourly buckets', jsonb_array_length(public.monitor_overview(:'proj')->'hourly')::text, '24');

-- ===== key limits =====
select set_config('request.jwt.claim.sub', :'a', false);
do $$ begin for i in 1..10 loop perform public.ingestion_key_create((select id from core.environments where slug = 'development' and org_id = (select id from core.organizations where slug = 'mon')), 'k' || i); end loop; end $$;
select t.throws('an environment cannot hold more than 10 active keys', format('select public.ingestion_key_create(%L, %L)', :'envd', 'one-too-many'), 'too_many_keys');

-- ===== lockdown =====
select t.throws('browser role cannot call ingest', $$select public.ingest_events('\x00'::bytea, null, '[]'::jsonb)$$, '42501');
reset role; set role anon;
select t.throws('anon cannot call ingest', $$select public.ingest_events('\x00'::bytea, null, '[]'::jsonb)$$, '42501');
select t.throws('anon cannot read events', 'select * from monitor.events', '42501');
select t.throws('anon cannot list groups', format('select public.error_groups_list(%L)', :'proj'), '42501');
reset role;

-- ===== cascade =====
set role authenticated; select set_config('request.jwt.claim.sub', :'o', false);
select public.project_delete(:'proj');
reset role;
select t.eq('deleting a project removes its keys, events, groups and usage',
  ((select count(*) from monitor.ingestion_keys where project_id = :'proj') + (select count(*) from monitor.events where project_id = :'proj')
   + (select count(*) from monitor.error_groups where project_id = :'proj') + (select count(*) from monitor.usage where project_id = :'proj'))::text, '0');
select t.eq('the other org''s data survives', (select count(*) from monitor.ingestion_keys where project_id = :'projx')::text, '1');

\echo
\echo '=== MONITOR FAILURES ==='
select n, name, detail from t.results where not ok order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed, count(*) as total from t.results;
