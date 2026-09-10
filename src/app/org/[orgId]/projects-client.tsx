'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Boxes, CreditCard, Gauge, Github, Plus, Puzzle, Search, Settings, Users } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Select } from '@/components/form-controls'

const regions = [
  'eu-central-1 · Frankfurt',
  'eu-west-1 · Ireland',
  'us-east-1 · Virginia',
  'ap-south-1 · Mumbai',
]

const sidebar = [
  { label: 'Projects', icon: Boxes, active: true },
  { label: 'Team', icon: Users },
  { label: 'Integrations', icon: Puzzle },
  { label: 'Usage', icon: Gauge },
  { label: 'Billing', icon: CreditCard },
  { label: 'Organization settings', icon: Settings },
]

export type ProjectRow = { id: string; name: string; region: string; status: string }

function statusLabel(status: string) {
  if (status === 'paused') return 'Project is paused'
  if (status === 'provisioning') return 'Provisioning'
  if (status === 'stopped') return 'Stopped'
  return 'Healthy'
}

export function OrgProjects({
  org,
  initial,
}: {
  org: { id: string; name: string; plan: string }
  initial: ProjectRow[]
}) {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectRow[]>(initial)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [region, setRegion] = useState(regions[0])
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const filtered = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [projects, query],
  )

  async function create() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: '',
          organizationId: org.id,
          region: region.split(' · ')[0],
          databasePassword: password || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create project')
        return
      }
      setProjects((prev) => [
        {
          id: data.project.id,
          name: data.project.name,
          region: data.project.region ?? region.split(' · ')[0],
          status: data.project.status ?? 'provisioning',
        },
        ...prev,
      ])
      setName('')
      setPassword('')
      setOpen(false)
      router.refresh()
    } catch {
      setError('Failed to create project')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex">
      <aside className="hidden w-56 shrink-0 border-r border-border bg-surface p-3 md:block">
        <nav className="space-y-1">
          {sidebar.map((item) => (
            <span
              key={item.label}
              className={`flex cursor-default items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
                item.active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <item.icon className="h-4 w-4" /> {item.label}
            </span>
          ))}
        </nav>
      </aside>

      <main className="flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold text-foreground">Projects</h1>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_280px]">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for a project"
                  className="w-full rounded-md border border-input bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25"
                />
              </div>
              <button
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-2 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
              >
                <Plus className="h-4 w-4" /> New project
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => (
                <Link
                  key={p.id}
                  href={`/project/${p.id}`}
                  className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-brand/50 hover:bg-surface-2"
                >
                  <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">AWS · {p.region}</p>
                  <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        p.status === 'active'
                          ? 'bg-brand'
                          : p.status === 'provisioning'
                            ? 'bg-amber-400'
                            : 'bg-muted-foreground'
                      }`}
                    />
                    {statusLabel(p.status)}
                  </p>
                </Link>
              ))}
              {filtered.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
                  {projects.length === 0
                    ? 'No projects yet — create your first one.'
                    : 'No projects found.'}
                </p>
              ) : null}
            </div>
          </div>

          <aside>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{org.plan} plan usage</p>
                <p className="text-xs text-muted-foreground">Current billing cycle</p>
              </div>
              <span className="cursor-default rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground">
                Upgrade
              </span>
            </div>
            <ul className="mt-5 space-y-4">
              {[
                { label: 'Projects', value: `${projects.length} / ${org.plan === 'Free' ? 2 : '∞'}` },
                { label: 'Database size', value: '— / 500 MB' },
                { label: 'Monthly active users', value: '— / 50,000' },
                { label: 'File storage', value: '— / 1 GB' },
              ].map((u) => (
                <li key={u.label}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{u.label}</span>
                    <span className="text-foreground">{u.value}</span>
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-surface-2">
                    <div className="h-1 rounded-full bg-brand" style={{ width: '8%' }} />
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </main>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create a new project</DialogTitle>
            <DialogDescription>
              Your project gets a dedicated instance and a full Postgres database, with an API ready
              to use.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-5 overflow-y-auto py-2 pr-1">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Field label="Organization">
              <div className="flex items-center gap-2 rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground">
                {org.name}
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {org.plan}
                </span>
              </div>
            </Field>
            <Field label="Git (optional)" hint="Push schema changes from your repository and we deploy them.">
              <button
                type="button"
                disabled
                title="Not available yet — see the GitHub integration ticket"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted-foreground opacity-60"
              >
                <Github className="h-4 w-4" /> Connect repository
              </button>
            </Field>
            <Field label="Project name">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25"
              />
            </Field>
            <Field
              label="Database password"
              hint={password.length > 10 ? 'This password is strong.' : 'Use a long, hard to guess password.'}
            >
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Type in a strong password"
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25"
              />
              <div className="mt-2 h-1 rounded-full bg-surface-2">
                <div
                  className="h-1 rounded-full bg-brand transition-all"
                  style={{ width: `${Math.min(password.length * 8, 100)}%` }}
                />
              </div>
            </Field>
            <Field label="Region" hint="Pick the region closest to your users.">
              <Select value={region} onChange={setRegion} options={regions} />
            </Field>
            <Field label="Security">
              <div className="space-y-3">
                {[
                  ['Enable Data API', 'Autogenerate a REST API for your public schema.'],
                  ['Expose new tables', 'Grants privileges to API roles by default.'],
                  ['Automatic RLS', 'Enable Row Level Security on every new table.'],
                ].map(([title, body], i) => (
                  <label key={title} className="flex gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      defaultChecked={i < 2}
                      className="mt-0.5 h-4 w-4 accent-[hsl(var(--brand))]"
                    />
                    <span>
                      <span className="block text-foreground">{title}</span>
                      <span className="block text-xs text-muted-foreground">{body}</span>
                    </span>
                  </label>
                ))}
              </div>
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
              {busy ? 'Creating…' : 'Create new project'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
