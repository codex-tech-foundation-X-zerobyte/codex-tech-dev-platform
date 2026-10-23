import { useState } from 'react'
import logoUrl from '../assets/logo.svg'
import { supabase, configured } from '../lib/supabase'

type Mode = 'in' | 'up' | 'forgot' | 'recovery'
const MIN_PASSWORD = 8

export function Auth({ recovery, onRecovered, initialMode }: { recovery?: boolean; onRecovered?: () => void; initialMode?: 'in' | 'up' }) {
  const [mode, setMode] = useState<Mode>(recovery ? 'recovery' : (initialMode ?? 'in'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  function switchMode(m: Mode) { setMode(m); setError(''); setNotice('') }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(''); setNotice('')
    if ((mode === 'up' || mode === 'recovery') && password.length < MIN_PASSWORD) {
      return setError(`Use at least ${MIN_PASSWORD} characters for the password.`)
    }
    setBusy(true)
    try {
      if (mode === 'in') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (err) setError('Sign in failed. Check your email and password.')
      } else if (mode === 'up') {
        const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } })
        if (err) setError('Could not create the account. Check the details and try again.')
        else if (!data.session) setNotice('Check your email to confirm your account, then sign in.')
      } else if (mode === 'forgot') {
        await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
        setNotice('If an account exists for that email, a reset link is on its way.')
      } else {
        const { error: err } = await supabase.auth.updateUser({ password })
        if (err) setError('Could not set the new password. Try the reset link again.')
        else onRecovered?.()
      }
    } finally { setBusy(false) }
  }

  const title = { in: 'Sign in', up: 'Create your account', forgot: 'Reset your password', recovery: 'Choose a new password' }[mode]
  const cta = { in: 'Continue', up: 'Create account', forgot: 'Send reset link', recovery: 'Save password' }[mode]

  return (
    <div className="center">
      <div className="hero">
        <div>
          <a className="lg" href="#/" style={{ padding: '0 0 28px' }}><img src={logoUrl} alt="" /> Codex</a>
          <h1>Monitor your apps and payments in one verified dashboard.</h1>
          <p className="mu" style={{ fontSize: 16, margin: 0 }}>Connect what you already run. A capability shows as connected only after a real test passes.</p>
        </div>
        <div className="card padded login">
          {mode !== 'recovery' && (
            <div className="auth-tabs">
              <button type="button" aria-pressed={mode === 'in'} onClick={() => switchMode('in')}>Sign in</button>
              <button type="button" aria-pressed={mode === 'up'} onClick={() => switchMode('up')}>Create account</button>
            </div>
          )}
          <h1 style={{ fontSize: 18, marginBottom: 16 }}>{title}</h1>
          {!configured && <div className="msg err" role="alert">Supabase is not configured. Set the VITE_ variables.</div>}
          <form className="stack" onSubmit={submit}>
            {mode !== 'recovery' && (
              <div><label htmlFor="em">Email</label><input id="em" className="in" style={{ width: '100%' }} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            )}
            {mode !== 'forgot' && (
              <div>
                <label htmlFor="pw">{mode === 'recovery' ? 'New password' : 'Password'}</label>
                <input id="pw" className="in" style={{ width: '100%' }} type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            )}
            <button className="btn pri" type="submit" disabled={busy}>{busy ? 'Please wait...' : cta}</button>
            <p className="msg err" role="alert" hidden={!error} style={{ margin: 0 }}>{error}</p>
            <p className="msg ok" role="status" hidden={!notice} style={{ margin: 0 }}>{notice}</p>
          </form>
          {mode === 'in' && <p style={{ margin: '16px 0 0' }}><button type="button" className="link" onClick={() => switchMode('forgot')}>Forgot password?</button></p>}
          {mode === 'forgot' && <p style={{ margin: '16px 0 0' }}><button type="button" className="link" onClick={() => switchMode('in')}>Back to sign in</button></p>}
          {!recovery && <p style={{ margin: '16px 0 0' }}><a href="#/">Back to home</a></p>}
        </div>
      </div>
    </div>
  )
}
