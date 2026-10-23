# Decision log
| ID | Decision | Status |
|---|---|---|
| D-01 | Orange accent. `#F2650D` approved as provisional in the designs and used in the logo. Final shade to be confirmed. | Provisional |
| D-02 | Trademark and domain search for "Codex". | Open |
| D-03 | Ingestion runs as a Supabase Edge Function at first. The logic is in plain TypeScript (`handler.ts`, `validate.ts`) and Postgres functions, so a dedicated service can replace the thin `index.ts` wrapper later. | Decided (recommended by Claude, owner asked to proceed) |
| D-04 | Merchant of record vs direct Paystack/Stripe for Codex's own billing. | Open |
| D-05 | First private-beta users. | Open |
| D-06 | Plan names, prices, currencies. | Open |
| D-07 | Codex Mail API draft (needed before Phase 4). | Open |
| D-08 | Alerts: in-app and outgoing webhook first, Codex Mail later, no Resend. | Decided |
| D-09 | Supabase now, portable SQL, AWS or Oracle later. | Decided |
| D-10 | Paystack and Stripe at launch, Flutterwave after. | Decided |
| D-11 | Three separate private repos (waitlist, admin, platform) on one Supabase project; platform repo owns all migrations. | Decided |
| D-12 | Hosting on Vercel (Hobby for the waitlist; Pro recommended for admin and platform). | Decided |
| D-13 | Platform app is a Vite + React + TypeScript SPA, same stack as the other two apps, at the root of the platform repo. | Decided (built) |
| D-14 | Project-level membership is deferred. Until it exists, every org member sees every project in the org, and Contract E's "projects they belong to" means all org projects. | Decided (revisit before beta) |
| D-15 | Admins manage projects and non-owner members; only owners add or change owners and delete the org; nobody changes their own role; the last owner cannot leave or be demoted; any member may leave. | Decided (implemented in 0003) |
| D-16 | Platform users pay monthly. Plan, price and provider details are deferred until after the core app (owner: "leave that for now"). | Decided, details open |
| D-17 | Until plans exist, every project has a default cap of 100,000 events per month (override per project in `monitor.project_limits`). A batch that would pass the cap is refused whole with `quota_exceeded`. | Decided, to revisit with billing |
| D-18 | Capability state (Contract D) is derived when read in Slice 3: no active key is Setup required, a key with no events is Verifying, an event in the last 24 hours is Connected, older is Degraded. State history (reason, changed_at) is not stored yet; it arrives with the second integration (payments). Failure-based Degraded and the 15-minute Disconnected rule are not built. | Deviation from Contract D, flagged |
| D-19 | Rate limiting identifies a client only by headers set by the trusted edge (`cf-connecting-ip`, then `x-real-ip`), never `x-forwarded-for`. Only salted hashes are stored. If no such header arrives, per-client limits are skipped and per-email, per-key and global limits still apply. Not yet verified on real Supabase. | Decided, needs verification |
| D-20 | Ingestion limits: 6,000 events per key per minute; 30 failed key attempts per client per 10 minutes; 10 active keys per environment; 100 events or 512 KB per request. Starting values to measure. | Decided |
| D-21 | The platform app reports its own errors to its own Monitor project (opt-in via `VITE_SELF_MONITOR_KEY`). The key is visible in the browser, so it must belong to a dedicated project with a low cap. The ingest function accepts browser calls only from exact origins listed in `CORS_ALLOW_ORIGINS`. | Decided, flagged as an exception to "keys stay on servers" |

