// Copy-paste examples for sending a first event. Each one is tested against the real validator (snippets.test.ts).
export type SnippetKind = 'powershell' | 'cmd' | 'bash' | 'node' | 'typescript' | 'python'
export type SnippetInput = { endpoint: string; key: string; eventId: string; at: string }
export type SnippetInfo = { kind: SnippetKind; label: string; how: string }

export const SNIPPETS: SnippetInfo[] = [
  { kind: 'powershell', label: 'PowerShell', how: 'Windows, and the VS Code terminal when its name says powershell. Paste and press Enter.' },
  { kind: 'cmd', label: 'Command Prompt', how: 'Windows cmd.exe, and the VS Code terminal when its name says cmd. Needs Windows 10 or newer (it includes curl.exe).' },
  { kind: 'bash', label: 'Bash', how: 'macOS, Linux, WSL, and Git Bash. Paste and press Enter.' },
  { kind: 'node', label: 'Node.js', how: 'Save as test-event.mjs and run: node test-event.mjs (Node 18 or newer).' },
  { kind: 'typescript', label: 'TypeScript', how: 'Save as codex.mts and run: npx tsx codex.mts (Node 18 or newer).' },
  { kind: 'python', label: 'Python', how: 'Save as test_event.py and run: python test_event.py (Python 3.8 or newer, no packages needed).' },
]

const json = (o: SnippetInput) =>
  `{"events":[{"event_id":"${o.eventId}","type":"error","occurred_at":"${o.at}","error":{"type":"TestError","message":"Hello from Codex"}}]}`
const escaped = (o: SnippetInput) => json(o).replace(/"/g, '\\"')

export function buildSnippet(kind: SnippetKind, o: SnippetInput): string {
  switch (kind) {
    case 'powershell':
      return `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$body = '{"events":[{"event_id":"' + [guid]::NewGuid() + '","type":"error","occurred_at":"' + (Get-Date).ToUniversalTime().ToString('o') + '","error":{"type":"TestError","message":"Hello from Codex"}}]}'
Invoke-RestMethod -Method Post -Uri '${o.endpoint}' \`
  -Headers @{ Authorization = 'Bearer ${o.key}' } \`
  -ContentType 'application/json' -Body $body`
    case 'cmd':
      return `curl.exe -X POST "${o.endpoint}" -H "Authorization: Bearer ${o.key}" -H "Content-Type: application/json" -d "${escaped(o)}"`
    case 'bash':
      return `curl -X POST "${o.endpoint}" \\
  -H "Authorization: Bearer ${o.key}" \\
  -H "Content-Type: application/json" \\
  -d "${escaped(o)}"`
    case 'node':
      return `// test-event.mjs  (Node 18 or newer)
import { randomUUID } from 'node:crypto'

const INGEST_URL = '${o.endpoint}'
const CODEX_KEY = '${o.key}' // in real apps, read this from an environment variable

export async function reportError(err) {
  const e = err instanceof Error ? err : new Error(String(err))
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${CODEX_KEY}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [{
      event_id: randomUUID(),
      type: 'error',
      occurred_at: new Date().toISOString(),
      error: { type: e.name, message: e.message, stack: e.stack },
    }] }),
  })
  console.log(res.status, await res.text())
}

await reportError(new Error('Hello from Codex'))`
    case 'typescript':
      return `// codex.mts  (Node 18 or newer, run with: npx tsx codex.mts)
import { randomUUID } from 'node:crypto'

const INGEST_URL = '${o.endpoint}'
const CODEX_KEY: string = '${o.key}' // in real apps, read this from an environment variable

type IngestResult = { accepted: number; duplicates: number; rejected: { index: number; reason: string }[] }

export async function reportError(err: unknown): Promise<IngestResult | null> {
  const e = err instanceof Error ? err : new Error(String(err))
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${CODEX_KEY}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [{
      event_id: randomUUID(),
      type: 'error',
      occurred_at: new Date().toISOString(),
      error: { type: e.name, message: e.message, stack: e.stack },
    }] }),
  })
  if (!res.ok) { console.error('Codex rejected the event', res.status, await res.text()); return null }
  return (await res.json()) as IngestResult
}

console.log(await reportError(new Error('Hello from Codex')))`
    case 'python':
      return `# test_event.py  (Python 3.8 or newer, standard library only)
import json, uuid, urllib.request
from datetime import datetime, timezone

INGEST_URL = "${o.endpoint}"
CODEX_KEY = "${o.key}"  # in real apps, read this from an environment variable

body = json.dumps({"events": [{
    "event_id": str(uuid.uuid4()),
    "type": "error",
    "occurred_at": datetime.now(timezone.utc).isoformat(),
    "error": {"type": "TestError", "message": "Hello from Codex"},
}]}).encode()

req = urllib.request.Request(INGEST_URL, data=body, method="POST", headers={
    "Authorization": "Bearer " + CODEX_KEY,
    "Content-Type": "application/json",
})
with urllib.request.urlopen(req) as res:
    print(res.status, res.read().decode())`
  }
}

// Windows machines default to PowerShell; everything else to Bash. The person's own choice is remembered.
export function defaultKind(userAgent: string): SnippetKind {
  return /windows/i.test(userAgent) ? 'powershell' : 'bash'
}
