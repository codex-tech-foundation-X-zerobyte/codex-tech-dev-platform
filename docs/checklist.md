# Implementation checklist
Statuses: [x] done and verified, [ ] not started, [~] in progress, [!] blocked, [?] needs decision, [>] deferred.

## Phase 1: Foundation and design
- [x] Slice 0: waitlist (owner reports live; SQL tested locally only)
- [x] Slice 0b: admin console v1 (waitlist, team, audit; not yet run against real Supabase by me)
- [x] Inspect repository and record state (`status.md`)
- [~] Design tokens and light/dark themes (draft in `design-system.md`)
- [x] Contract A: Event Schema v1 (approved 21 Oct 2026)
- [x] Contract B: Payment Event Contract (approved 21 Oct 2026)
- [x] Contract C: Module Registry (approved 21 Oct 2026)
- [x] Contract D: Capability State Machine (approved 21 Oct 2026)
- [x] Contract E: Roles and Permissions (approved 21 Oct 2026)
- [x] Contract F: Notifications and Usage (approved 21 Oct 2026)
- [x] Migration 0003: core schema (orgs, memberships, projects, environments, org audit log) with RLS, written and tested locally
- [ ] Run migration 0003 on the real Supabase project and re-run the isolation checks there (owner action)
- [x] Tenant-isolation SQL tests: 99 checks pass locally (`supabase/tests/run_local.sh`); deliberate security breaks were caught by the tests
- [ ] Run tenant-isolation tests in CI (needs a CI service; later)
- [x] Platform app scaffold (Vite + React + TS), auth, theme, shared UI (20 automated checks; not yet run against the real Supabase project)
- [x] Org and project creation flow (built, tested with a mocked backend)
- [~] Dashboard shell (done); module registry (not started)
- [ ] Capability statuses and initial setup flows
- [?] Performance, availability, alert-delivery and recovery targets

## Phase 2 to 4 and deferred
See `../../plan.md` Appendix A. Unchanged.
- [x] Waitlist abuse protection (migration 20261021000004, 13 checks): per-client, per-email and global limits
- [x] Slice 3: Monitor ingestion. Migration 20261021000005 (keys, events, error groups, usage, limits), ingest Edge Function, Overview, Errors, Error detail and Setup screens
- [x] Slice 3 tests: 208 SQL checks, 30 function unit tests, 7 handler-to-database end-to-end tests, 38 app tests; function entry point started and type-checked under real Deno
- [x] Landing page for signed-out visitors (not yet looked at in a real browser by me), sign-out on the first-run screen
- [x] Setup examples for PowerShell, Command Prompt, Bash, Node.js, TypeScript and Python (tested by running them)
- [x] Self-monitoring: the app reports its own errors (opt-in), hidden test page `#/debug`, exact-origin CORS on the function, sample data script (tests include a real-database run)
- [ ] Deploy the ingest function and run migrations 4 and 5 on the real Supabase project (owner action)
- [ ] Verify on real Supabase that `cf-connecting-ip` or `x-real-ip` reaches the database and the function (D-19)
- [ ] Data retention and cleanup of old events (needs plans)
- [ ] Persisted capability history (D-18)

## Next recommended slice
Slice 4: Alerts. Rules (new error group, error rate, failed payments later), in-app and signed outgoing webhook channels, delivery history with honest failures and retries (Contract F). Acceptance: a new error group creates one alert (deduplicated, with cooldown), the webhook is signed, a failing endpoint shows Failed with retries and never Sent.
Before that, run everything on the real Supabase project and report what breaks.

