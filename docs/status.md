# Verified status (21 Oct 2026)

| Area | State | Evidence |
|---|---|---|
| Waitlist app (`codex-waitlist`) | Built, deployed on Vercel per owner | 6 unit tests and build pass locally |
| Admin app (`codex-admin`) | Built, not yet confirmed deployed | 5 unit tests and build pass locally |
| SQL: waitlist, admin roles, audit log | Written | Role tests passed on a LOCAL Postgres with Supabase stubs only |
| Real Supabase project | Not verified by me | Owner must confirm migrations 0001 and 0002 were run and the super admin exists |
| Core schema 0003 (orgs, members, projects, environments, org audit log, RLS) | Written, 99 local checks pass | `supabase/tests/run_local.sh`; NOT yet run on the real Supabase project |
| Platform app (auth, org/project, settings) | Built; 20 automated checks pass; type-check and build pass | NOT yet run against real Supabase or deployed |
| Monitor ingestion (keys, events, error groups, Edge Function) and its screens | Built and tested locally (208 SQL, 30 function, 7 end-to-end, 38 app checks); function started under Deno | NOT deployed; migrations 4 and 5 NOT run on real Supabase |
| Alerts,  ingestion, SDK, payments, billing, AI | Not started | No code exists |

Existing schemas: `waitlist`, `admin` (staff console roles: super_admin, admin, viewer). These are **Codex staff** roles and are separate from customer organization roles (Contract E).
