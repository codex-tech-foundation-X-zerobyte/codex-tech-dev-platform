import { supabase } from '../lib/supabase'

// Shown on screens that appear before the main app shell, so a signed-in person can always see who they are and sign out.
export function SignedInAs({ email }: { email: string }) {
  return (
    <p className="mu" style={{ textAlign: 'center', marginTop: 16 }}>
      Signed in as <strong>{email}</strong>. Not you?{' '}
      <button type="button" className="link" onClick={() => { void supabase.auth.signOut() }}>Sign out</button>
    </p>
  )
}
