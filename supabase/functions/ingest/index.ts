// Supabase Edge Function entry point. All logic lives in handler.ts so it can be tested without Deno.
// Deploy with JWT verification OFF (callers authenticate with an ingestion key, not a Supabase JWT):
//   supabase functions deploy ingest --no-verify-jwt
// Optional secret: supabase secrets set IP_HASH_SALT=<random string>
// Optional, only for browsers that report to this endpoint: supabase secrets set CORS_ALLOW_ORIGINS=https://app.example.com,http://localhost:5173
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handle, parseCorsOriginsDetailed } from './handler.ts'

declare const Deno: { env: { get(name: string): string | undefined }; serve(h: (req: Request) => Response | Promise<Response>): void }

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const cors = parseCorsOriginsDetailed(Deno.env.get('CORS_ALLOW_ORIGINS'))
console.log(`ingest started. Browser origins allowed: ${cors.allowed.length ? cors.allowed.join(', ') : 'none'}.${cors.ignored.length ? ` Ignored because they are not exact origins: ${cors.ignored.join(', ')}.` : ''}`)

Deno.serve((req) => handle(req, {
  rpc: async (fn, args) => {
    const { data, error } = await admin.rpc(fn, args)
    return { data, error: error ? { code: error.code, message: error.message } : null }
  },
  ipSalt: Deno.env.get('IP_HASH_SALT') ?? serviceKey,
  corsOrigins: cors.allowed,
}))
