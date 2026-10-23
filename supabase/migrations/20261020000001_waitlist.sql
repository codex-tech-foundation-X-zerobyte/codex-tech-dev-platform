-- Codex waitlist schema. Move this file into the single migrations owner
-- (codex-tech-developers-platform/supabase/migrations) when that repo exists.
-- Run once in the Supabase SQL Editor.

create schema if not exists waitlist;

create table if not exists waitlist.signups (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  language         text not null,
  payment_provider text not null,
  note             text,
  consent          boolean not null,
  consented_at     timestamptz not null default now(),
  status           text not null default 'new'
                   check (status in ('new', 'invited', 'removal_requested')),
  created_at       timestamptz not null default now(),
  constraint signups_email_len check (char_length(email) between 3 and 254),
  constraint signups_note_len  check (note is null or char_length(note) <= 500)
);

create unique index if not exists signups_email_unique on waitlist.signups (lower(email));
create index if not exists signups_created_at_idx on waitlist.signups (created_at desc);

-- Lock the table down. The public never reads or writes it directly.
alter table waitlist.signups enable row level security;
revoke all on schema waitlist from anon, authenticated;
revoke all on all tables in schema waitlist from anon, authenticated;
-- Admin read policies are added later by the admin console migration.

-- The only public entry point: validates input, hides duplicates, throttles floods.
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
begin
  -- Bots fill the honeypot. Pretend success, store nothing.
  if p_website is not null and btrim(p_website) <> '' then
    return jsonb_build_object('ok', true);
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

  -- Global flood guard (add Cloudflare Turnstile or rate limiting at the edge later).
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
