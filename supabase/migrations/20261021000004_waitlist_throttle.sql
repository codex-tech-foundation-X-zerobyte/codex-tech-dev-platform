-- Waitlist abuse protection: per-client, per-email and global attempt limits, kept in Postgres.
-- Replaces public.join_waitlist (same signature, same responses, plus error 'rate_limited').
--
-- Client identity: the hash of the connecting IP, taken only from headers set by the trusted edge in front of Supabase
-- (cf-connecting-ip, then x-real-ip). x-forwarded-for is deliberately NOT used because a caller can write to it.
-- If neither header is present the per-client limit is skipped; the per-email and global limits still apply.
-- Only a salted hash is stored, never the address, and counters are deleted after two days.

create table if not exists waitlist.throttle_salt (id boolean primary key default true check (id), salt text not null);
insert into waitlist.throttle_salt (salt) values (encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'))
on conflict (id) do nothing;

create table if not exists waitlist.throttle (
  bucket       text not null,
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (bucket, key, window_start)
);
create index if not exists throttle_window_idx on waitlist.throttle (window_start);

alter table waitlist.throttle_salt enable row level security;
alter table waitlist.throttle enable row level security;
revoke all on waitlist.throttle_salt, waitlist.throttle from public, anon, authenticated;

-- Counts one hit and says whether the caller is still within the limit for the current window.
create or replace function waitlist._allow(p_bucket text, p_key text, p_window_seconds int, p_limit int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); n int;
begin
  insert into waitlist.throttle as t (bucket, key, window_start, hits) values (p_bucket, p_key, w, 1)
  on conflict (bucket, key, window_start) do update set hits = t.hits + 1
  returning t.hits into n;
  return n <= p_limit;
end $$;
revoke all on function waitlist._allow(text, text, int, int) from public, anon, authenticated;

create or replace function waitlist._client_hash() returns text
language plpgsql stable security definer set search_path = '' as $$
declare h json; ip text;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  ip := nullif(btrim(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', '')), '');
  if ip is null or char_length(ip) > 64 then return null; end if;
  return encode(sha256(convert_to((select salt from waitlist.throttle_salt) || ip, 'UTF8')), 'hex');
end $$;
revoke all on function waitlist._client_hash() from public, anon, authenticated;

create or replace function public.join_waitlist(
  p_email    text,
  p_language text,
  p_provider text,
  p_note     text,
  p_consent  boolean,
  p_website  text default null   -- honeypot: real users leave this empty
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_client text;
begin
  -- Bots fill the honeypot. Pretend success, store nothing.
  if p_website is not null and btrim(p_website) <> '' then
    return jsonb_build_object('ok', true);
  end if;

  -- Every real attempt counts, valid or not, so probing is limited too.
  if random() < 0.02 then
    delete from waitlist.throttle where window_start < now() - interval '2 days';
  end if;
  v_client := waitlist._client_hash();
  if not waitlist._allow('global', 'all', 3600, 1000) then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  if v_client is not null and not waitlist._allow('client', v_client, 3600, 20) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if char_length(v_email) between 3 and 254
     and not waitlist._allow('email', encode(sha256(convert_to(v_email, 'UTF8')), 'hex'), 3600, 3) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  if p_consent is not true then
    return jsonb_build_object('ok', false, 'error', 'consent_required');
  end if;
  if p_language not in ('typescript','python','go','other') then
    return jsonb_build_object('ok', false, 'error', 'invalid_language');
  end if;
  if p_provider not in ('paystack','stripe','flutterwave','other','none') then
    return jsonb_build_object('ok', false, 'error', 'invalid_provider');
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    return jsonb_build_object('ok', false, 'error', 'note_too_long');
  end if;

  -- Fast flood guard on stored signups.
  if (select count(*) from waitlist.signups where created_at > now() - interval '1 minute') > 60 then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;

  -- Duplicates return success so the form never reveals who is already on the list.
  insert into waitlist.signups (email, language, payment_provider, note, consent)
  values (v_email, p_language, p_provider, v_note, true)
  on conflict (lower(email)) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.join_waitlist(text, text, text, text, boolean, text) from public;
grant execute on function public.join_waitlist(text, text, text, text, boolean, text) to anon, authenticated;
