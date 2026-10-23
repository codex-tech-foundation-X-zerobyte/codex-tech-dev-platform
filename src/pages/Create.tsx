import { useState } from 'react'
import { api } from '../lib/api'
import { isValidName, isValidSlug, slugify } from '../lib/slug'

type FormProps = {
  title: string; intro: string; nameLabel: string; submitLabel: string
  onSubmit: (name: string, slug: string) => Promise<void>
}

function NameSlugForm({ title, intro, nameLabel, submitLabel, onSubmit }: FormProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [edited, setEdited] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!isValidName(name)) return setError('Enter a name (up to 80 characters).')
    if (!isValidSlug(slug)) return setError('The short name needs 2 to 40 lowercase letters, numbers or dashes, and cannot start or end with a dash.')
    setBusy(true); setError('')
    try { await onSubmit(name.trim(), slug) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="card padded" style={{ width: 520, maxWidth: '100%' }}>
      <h1>{title}</h1>
      <p className="mu h-sub">{intro}</p>
      <form className="stack" onSubmit={submit}>
        <div><label htmlFor="nm">{nameLabel}</label><input id="nm" className="in" style={{ width: '100%' }} value={name} maxLength={80} onChange={(e) => { setName(e.target.value); if (!edited) setSlug(slugify(e.target.value)) }} required /></div>
        <div><label htmlFor="sl">Short name (used in links)</label><input id="sl" className="in mono" style={{ width: '100%' }} value={slug} onChange={(e) => { setEdited(true); setSlug(e.target.value.toLowerCase()) }} required /></div>
        <p className="msg err" role="alert" hidden={!error} style={{ margin: 0 }}>{error}</p>
        <button className="btn pri" type="submit" disabled={busy}>{busy ? 'Creating...' : submitLabel}</button>
      </form>
    </div>
  )
}

export function CreateOrg({ onDone }: { onDone: (orgId: string) => void }) {
  return (
    <NameSlugForm
      title="Create your organization" intro="Your team, projects and billing live here. You become the owner."
      nameLabel="Organization name" submitLabel="Create organization"
      onSubmit={async (n, s) => { const o = await api.createOrg(n, s); onDone(o.id) }}
    />
  )
}

export function CreateProject({ orgId, onDone }: { orgId: string; onDone: (projectId: string) => void }) {
  return (
    <NameSlugForm
      title="Create a project" intro="A project is one app or service. It starts with Production and Development environments."
      nameLabel="Project name" submitLabel="Create project"
      onSubmit={async (n, s) => { const p = await api.createProject(orgId, n, s); onDone(p.id) }}
    />
  )
}
