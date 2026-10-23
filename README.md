# codex-tech-developers-platform

The main Codex Tech Developers Platform. **Owns all database migrations** for the shared Supabase project.
The platform app (Vite + React + TypeScript) lives at the root of this repo; `docs/` holds the contracts and checklist. See `../plan.md` and `../continue.md`.

## Database (run in this order, in the Supabase SQL Editor)
1. `supabase/migrations/20261020000001_waitlist.sql` (waitlist schema and public signup function)
2. `supabase/migrations/20261020000002_admin.sql` (admin schema, roles, audit log, admin functions)
3. `supabase/migrations/20261021000003_core.sql` (organizations, members, projects, environments, org audit log)
4. Create your first user in Supabase: Authentication > Users > Add user (tick auto confirm).
5. Edit the email in `supabase/seed_super_admin.sql` and run it to make that user the super admin.

New migrations go in `supabase/migrations/` with the next number. Never edit an applied migration; add a new one.

## Tests
Run `supabase/tests/run_local.sh` against a local throwaway Postgres 16 (it builds a scratch database, applies the migrations and runs 99 tenant-isolation and role checks; it exits non-zero on any failure). `supabase/tests/` holds the SQL role tests (stub Supabase auth, then check who can do what). They are for a LOCAL throwaway Postgres only. Never run `stub_supabase.sql` in Supabase.

## Push the database with the Supabase CLI (alternative to the SQL Editor)
```
npm install -g supabase        # or use npx supabase
supabase init                  # once; creates supabase/config.toml, keeps existing migrations
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```
The five migrations are safe to re-run, so it does not matter if you already ran them by hand. If `db push` reports a mismatch, mark the ones you ran manually as applied:
`supabase migration repair --status applied 20261020000001 20261020000002` (add the later ones too if you ran them by hand).
`supabase/seed_super_admin.sql` and `supabase/tests/` are not migrations and are never pushed.

## Run the app
```
cp .env.example .env.local     # fill in your Supabase URL and anon (public) key
npm install
npm run dev                    # npm test runs the unit, screen and function checks; npm run build type-checks and builds
```
In Supabase, Authentication > URL Configuration: set Site URL to your deployed address and add it (and `http://localhost:5173`) to Redirect URLs, so confirmation and password-reset links come back to the app.

## Deploy (Vercel)
Import this repo as a Vite project (settings come from `vercel.json`) and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Vercel Pro is recommended for the platform (Hobby is non-commercial and cannot deploy private organization repos).

## What exists now (Slices 2 and 3)
- A public landing page for signed-out visitors (`#/`), with `#/signin` and `#/signup`.
- Sign in, sign up, password reset; light and dark themes with no flash.
- Organizations and projects, switchers, members and roles, audit log, deletion with typed confirmation.
- Codex Monitor: ingestion keys (shown once, stored hashed), ingest Edge Function (see `supabase/functions/ingest/README.md` and `docs/ingestion-api.md`), error groups with status, Overview with real counts, Setup page whose status turns Connected only after a real event arrives.
- Abuse limits: waitlist throttle, per-key rate limit, failed-key throttle, monthly cap.
Not built: Alerts, Payments, Modules, Billing, AI. They appear as "Coming next".

## Monitor Codex with Codex (use this app as your own test project)
You do not need another app to try Monitor. This app can report its own errors to its own Codex project.
1. Sign in, create an organization and a project named for example `Codex Platform`. Use a project that is only for this, never a customer's.
2. Open Setup, create a key named `platform web app` in the Production environment, and copy it (it is shown once).
3. Optional but recommended: give that project a low monthly cap so a leaked key cannot flood it. In the Supabase SQL Editor run `select p.id, p.name, o.slug from core.projects p join core.organizations o on o.id = p.org_id;` to find the project id, then `insert into monitor.project_limits (project_id, monthly_event_cap) values ('<project id>', 20000) on conflict (project_id) do update set monthly_event_cap = excluded.monthly_event_cap;`
4. Let your site call the function from a browser: `supabase secrets set CORS_ALLOW_ORIGINS=https://<your-app>.vercel.app,http://localhost:5173` and redeploy the function (`supabase functions deploy ingest --no-verify-jwt`). Only exact origins work; `*` is ignored on purpose.
5. In Vercel (or `.env.local` for local runs) set `VITE_SELF_MONITOR_KEY=<the key>` and redeploy the app.
6. Open `#/debug` in the app (for example `https://<your-app>.vercel.app/#/debug`). Press **Send a handled error**, then open Errors.
From then on the app also reports crashes, uncaught errors, unhandled promise rejections and unexpected database failures (not ordinary refusals such as "name already taken") by itself. At most 10 a minute, the same error once a minute, no emails, no query strings.
**Know the trade-off:** this key is compiled into the browser bundle, so anyone can read it. It can only add events to that one environment (it cannot read anything), and the per-key rate limit and the monthly cap bound the damage. If it is abused, revoke it on the Setup page and create another. Never put a key in browser code for any other purpose.
**If `#/debug` says the request was blocked** (the browser console shows a CORS error about the preflight): the function the browser reaches is not answering with an allow-origin header. Work through the checklist the page shows. In short: redeploy the function from the latest code with `supabase functions deploy ingest --no-verify-jwt` (code changes need a redeploy; secrets do not), set `supabase secrets set CORS_ALLOW_ORIGINS=https://<your-app>.vercel.app` (a trailing slash or capital letters are fine; paths and `*` are ignored), and use the PowerShell check on that page to see the real answer. A 401 means JWT checking is still on. The function log prints "Browser origins allowed: ..." each time it starts, which shows what it actually read.
**Just want data on the screens?** `scripts/send-sample-events.mjs` sends 97 realistic sample events (5 error causes, 30 custom events, some secrets to prove redaction). PowerShell: `$env:CODEX_INGEST_URL='https://<ref>.supabase.co/functions/v1/ingest'; $env:CODEX_KEY='cdx_...'; node scripts/send-sample-events.mjs`

## Deploy the ingestion function
`supabase functions deploy ingest --no-verify-jwt` (details in `supabase/functions/ingest/README.md`). Without `--no-verify-jwt`, every request is rejected.

## Tests
`supabase/tests/run_local.sh` (needs a local throwaway Postgres 16): 208 SQL checks. `npm test`: function and screen tests. With a local database: `CODEX_E2E_DB=<db> npx vitest run supabase/functions/ingest/e2e.test.ts`.

## If `supabase/.temp` shows up in git
`supabase link` creates local state in `supabase/.temp/`. It is now in `.gitignore`. If it was already committed, ignoring it is not enough; untrack it once: `git rm -r --cached supabase/.temp` then commit.
