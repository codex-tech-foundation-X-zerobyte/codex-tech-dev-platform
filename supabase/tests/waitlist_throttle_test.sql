-- Waitlist throttle tests. LOCAL throwaway Postgres only. Reuses the t.* helpers created by core_isolation_test.sql.
\set ON_ERROR_STOP on

set role anon;
select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.7"}', false);

-- per-client limit: 20 attempts an hour, then blocked. Distinct emails so only the client bucket trips.
select t.eq('first 20 attempts from one client succeed',
  (select count(*) filter (where (public.join_waitlist('u' || g || '@x.com', 'python', 'paystack', null, true))->>'ok' = 'true')::text from generate_series(1, 20) g)::text, '20');
select t.eq('21st attempt from the same client is limited',
  public.join_waitlist('u21@x.com', 'python', 'paystack', null, true)->>'error', 'rate_limited');

-- another client is unaffected
select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.8"}', false);
select t.eq('a different client is unaffected', public.join_waitlist('other@x.com', 'go', 'stripe', null, true)->>'ok', 'true');

-- x-forwarded-for cannot be used to dodge the limit or to frame someone
select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.7","x-forwarded-for":"198.51.100.1"}', false);
select t.eq('spoofed x-forwarded-for does not reset the limit', public.join_waitlist('spoof@x.com', 'go', 'stripe', null, true)->>'error', 'rate_limited');

-- per-email limit: 3 an hour, even from fresh clients
select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.50"}', false);
select public.join_waitlist('same@x.com', 'go', 'stripe', null, true);
select public.join_waitlist('same@x.com', 'go', 'stripe', null, true);
select public.join_waitlist('same@x.com', 'go', 'stripe', null, true);
select t.eq('4th attempt for one email is limited', public.join_waitlist('same@x.com', 'go', 'stripe', null, true)->>'error', 'rate_limited');
select t.eq('email limit is case-insensitive', public.join_waitlist('SAME@x.com', 'go', 'stripe', null, true)->>'error', 'rate_limited');

-- validation still runs and still counts
select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.60"}', false);
select t.eq('invalid email rejected', public.join_waitlist('not-an-email', 'go', 'stripe', null, true)->>'error', 'invalid_email');
select t.eq('missing consent rejected', public.join_waitlist('c@x.com', 'go', 'stripe', null, false)->>'error', 'consent_required');
select t.eq('honeypot pretends success', public.join_waitlist('bot@x.com', 'go', 'stripe', null, true, 'http://spam')->>'ok', 'true');
reset role;
select t.eq('honeypot stores nothing', (select count(*) from waitlist.signups where email = 'bot@x.com')::text, '0');
select t.eq('stored signups match successes', (select count(*) from waitlist.signups where email like 'u%@x.com')::text, '20');

-- no usable header: per-client limit skipped, email and global limits still work
set role anon;
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.9"}', false);
select t.eq('no trusted header still accepts a valid signup', public.join_waitlist('nohdr@x.com', 'go', 'stripe', null, true)->>'ok', 'true');
select set_config('request.headers', '', false);
select t.eq('empty headers setting is safe', public.join_waitlist('nohdr2@x.com', 'go', 'stripe', null, true)->>'ok', 'true');

-- privacy and lockdown
select t.throws('anon cannot read counters', 'select * from waitlist.throttle', '42501');
select t.throws('anon cannot read the salt', 'select * from waitlist.throttle_salt', '42501');
select t.throws('anon cannot call the counter helper', $$select waitlist._allow('x','y',60,1)$$, '42501');
reset role;
select t.eq('raw IP is never stored', (select count(*) from waitlist.throttle where key like '%203.0.113%')::text, '0');
select t.eq('client keys are 64-char hashes', (select bool_and(char_length(key) = 64) from waitlist.throttle where bucket in ('client','email'))::text, 'true');

-- global ceiling
update waitlist.throttle set hits = 1000 where bucket = 'global';
set role anon;
select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.99"}', false);
select t.eq('global ceiling answers busy', public.join_waitlist('late@x.com', 'go', 'stripe', null, true)->>'error', 'busy');
reset role;

-- old counters are cleaned up
insert into waitlist.throttle values ('client', 'old', now() - interval '3 days', 1);
do $$ begin for i in 1..400 loop perform public.join_waitlist('x', 'go', 'stripe', null, true); end loop; end $$;
select t.eq('stale counters are purged', (select count(*) from waitlist.throttle where key = 'old')::text, '0');

\echo
\echo '=== WAITLIST FAILURES ==='
select n, name, detail from t.results where not ok order by n;
