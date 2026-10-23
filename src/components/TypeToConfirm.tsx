import { useState } from 'react'

type Props = { word: string; action: string; busy?: boolean; onConfirm: () => void }

// Destructive actions need the exact name typed, so a stray click cannot delete anything.
export function TypeToConfirm({ word, action, busy, onConfirm }: Props) {
  const [v, setV] = useState('')
  const id = `confirm-${action.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); if (v === word && !busy) onConfirm() }}>
      <label htmlFor={id}>Type <span className="mono">{word}</span> to confirm</label>
      <div className="row wrap">
        <input id={id} className="in" value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" />
        <button className="btn danger" type="submit" disabled={v !== word || busy}>{busy ? 'Working...' : action}</button>
      </div>
    </form>
  )
}
