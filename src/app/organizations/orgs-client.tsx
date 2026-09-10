'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Boxes, Plus, Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Select } from '@/components/form-controls'

export type OrgRow = {
  id: string
  name: string
  type: string
  projectCount: number
  memberCount: number
}

/** "1 project" / "3 projects" — counts are read, so they must read correctly. */
function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function OrgsClient({ initial }: { initial: OrgRow[] }) {
  const router = useRouter()
  const [orgs, setOrgs] = useState<OrgRow[]>(initial)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('Personal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const filtered = useMemo(
    () => orgs.filter((o) => o.name.toLowerCase().includes(query.toLowerCase())),
    [orgs, query],
  )

  async function create() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create organization')
        return
      }
      setOrgs((prev) => [
        ...prev,
        {
          id: data.organization.id,
          name: data.organization.name,
          type: data.organization.type,
          projectCount: 0,
          // The creator is the owner, so a new organization has one member.
          memberCount: 1,
        },
      ])
      setName('')
      setType('Personal')
      setOpen(false)
      router.refresh()
    } catch {
      setError('Failed to create organization')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-14">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-foreground">Your organizations</h1>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New organization
        </button>
      </div>

      <div className="relative mt-8 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for an organization"
          className="w-full rounded-md border border-input bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25"
        />
      </div>

      <ul className="mt-6 space-y-3">
        {filtered.map((org) => (
          <li key={org.id}>
            <Link
              href={`/org/${org.id}`}
              className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-4 transition-colors hover:border-brand/50 hover:bg-surface-2"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-2">
                <Boxes className="h-4 w-4 text-brand" />
              </span>
              <span>
                <span className="block text-sm font-medium text-foreground">{org.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {plural(org.projectCount, 'project')} · {plural(org.memberCount, 'member')} ·{' '}
                  {org.type}
                </span>
              </span>
            </Link>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {orgs.length === 0
              ? 'No organizations yet — create your first one.'
              : `No organizations match “${query}”.`}
          </li>
        ) : null}
      </ul>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create a new organization</DialogTitle>
            <DialogDescription>
              Organizations group your projects. Each one has its own team members and billing
              settings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Field
              label="Name"
              hint="What's the name of your company or team? You can change this later."
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Organization name"
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25"
              />
            </Field>
            <Field
              label="Type"
              hint="What best describes your organization? Displayed on the organization card."
            >
              <Select
                value={type}
                onChange={setType}
                options={['Personal', 'Company', 'Educational', 'Agency']}
              />
            </Field>
          </div>

          <DialogFooter>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-3.5 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={create}
              disabled={busy}
              className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Create organization'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
