import { useMemo, useState } from 'react'
import { buildSnippet, defaultKind, SNIPPETS, type SnippetKind } from '../lib/snippets'

const KEY = 'codex-snippet-kind'
function initial(): SnippetKind {
  try { const s = localStorage.getItem(KEY); if (SNIPPETS.some((x) => x.kind === s)) return s as SnippetKind } catch { /* storage unavailable */ }
  return defaultKind(navigator.userAgent)
}
const fresh = () => ({ eventId: crypto.randomUUID(), at: new Date().toISOString() })

export function SnippetTabs({ endpoint, keyText }: { endpoint: string; keyText: string }) {
  const [kind, setKind] = useState<SnippetKind>(initial)
  const [sample, setSample] = useState(fresh)
  const [copied, setCopied] = useState(false)
  const info = SNIPPETS.find((s) => s.kind === kind)!
  const text = useMemo(() => buildSnippet(kind, { endpoint, key: keyText, ...sample }), [kind, endpoint, keyText, sample])

  function pick(k: SnippetKind) {
    setKind(k); setCopied(false)
    try { localStorage.setItem(KEY, k) } catch { /* storage unavailable */ }
  }
  async function copy() { try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) } }

  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Choose your shell or language" style={{ margin: '0 0 12px' }}>
        {SNIPPETS.map((s) => (
          <button key={s.kind} type="button" role="tab" id={`tab-${s.kind}`} aria-selected={kind === s.kind} aria-controls="snippet-panel" className="tabbtn" onClick={() => pick(s.kind)}>{s.label}</button>
        ))}
      </div>
      <div id="snippet-panel" role="tabpanel" aria-labelledby={`tab-${kind}`}>
        <p className="mu" style={{ margin: '0 0 8px' }}>{info.how}</p>
        <div className="code" tabIndex={0}>{text}</div>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="btn sm" type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
          {(kind === 'cmd' || kind === 'bash') && <button className="btn sm" type="button" onClick={() => { setSample(fresh()); setCopied(false) }}>New test event</button>}
        </div>
        {(kind === 'cmd' || kind === 'bash') && <p className="mu sm" style={{ margin: '8px 0 0' }}>This command carries one event id. Running it twice reports a duplicate. Press New test event for a fresh one.</p>}
      </div>
      <div style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>What you should see</h3>
        <div className="code">{'{"accepted":1,"duplicates":0,"rejected":[]}'}</div>
        <ul className="mu" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li><strong>401 invalid_key:</strong> the key was copied wrongly, or it was revoked. Create a new one.</li>
          <li><strong>400 or 413:</strong> the request was changed. Copy it again.</li>
          <li><strong>429:</strong> too many requests or the monthly limit. Wait a minute, then try again.</li>
          <li><strong>Cannot resolve host or an address starting with /functions:</strong> the ingest URL is incomplete. Ask whoever deployed this app to set VITE_SUPABASE_URL.</li>
        </ul>
      </div>
    </div>
  )
}
