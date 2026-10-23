# ingest Edge Function

All logic is in `handler.ts` and `validate.ts` (plain TypeScript, unit tested). `index.ts` only connects them to Supabase.

Deploy (JWT verification must be OFF, because callers authenticate with an ingestion key, not a Supabase login):
```
supabase functions deploy ingest --no-verify-jwt
supabase secrets set IP_HASH_SALT=<any long random string>      # optional but recommended
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function automatically. The service-role key never leaves the function.

Browsers cannot call the function unless you list their site: `supabase secrets set CORS_ALLOW_ORIGINS=https://app.example.com,http://localhost:5173` (exact origins only, no wildcards). Leave it unset if only servers send events.

Test it after deploying (replace the URL and key):
```
curl -X POST "https://<ref>.supabase.co/functions/v1/ingest" -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"events":[{"event_id":"'$(uuidgen)'","type":"error","occurred_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","error":{"type":"TestError","message":"hello"}}]}'
```
Local checks: `npm test` (unit tests), and with a local Postgres that has the migrations: `CODEX_E2E_DB=<db> npx vitest run supabase/functions/ingest/e2e.test.ts`.
