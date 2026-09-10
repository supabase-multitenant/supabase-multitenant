'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Check,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'

type Project = {
  id: string
  name: string
  slug: string
  description: string | null
  status: string
  region: string | null
  domain: string | null
  domainVerified: boolean | null
  studioDomain: string | null
  createdAt: string
}

type BackupRow = {
  id: string
  kind: string
  status: string
  fileName: string
  sizeBytes: number | string | null
  createdAt: string
  restoreCount: number
}

const STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  provisioning: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  stopped: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  error: 'bg-destructive/15 text-destructive border-destructive/40',
}

function humanBytes(value: number | string | null): string {
  if (value === null || value === undefined) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return String(value)
  const units = ['B', 'KB', 'MB', 'GB']
  let size = n
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`
}

export function ProjectClient({
  project,
  organization,
  permissions,
  studioBaseUrl,
  publicUrl,
  internalUrl,
  keys,
  backups,
}: {
  project: Project
  organization: { id: string; name: string } | null
  permissions: string[]
  studioBaseUrl: string | null
  publicUrl: string | null
  internalUrl: string | null
  keys: Array<{ key: string; value: string }>
  backups: BackupRow[]
}) {
  const router = useRouter()
  const can = (p: string) => permissions.includes(p)

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  const studioHref = project.studioDomain
    ? `https://${project.studioDomain}`
    : studioBaseUrl
      ? `${studioBaseUrl}/gateway/studio/${project.slug}/`
      : null

  async function deploy() {
    setBusy('deploy')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/deploy`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Deploy failed.')
      setNotice('Deploy started. Give it a moment, then reload.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deploy failed.')
    } finally {
      setBusy(null)
    }
  }

  async function backupNow() {
    setBusy('backup')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/backups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'database' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Backup failed.')
      setNotice(`Backup created: ${json.backup?.fileName ?? 'done'}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed.')
    } finally {
      setBusy(null)
    }
  }

  async function restore(backupId: string, fileName: string) {
    if (!confirm(`Restore ${fileName} into this project? Current data will be replaced.`)) return
    setBusy(backupId)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/backups/${backupId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwrite: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Restore failed.')
      setNotice('Restore complete.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed.')
    } finally {
      setBusy(null)
    }
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text)
    setNotice('Copied to clipboard.')
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      {/* header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground">{project.name}</h1>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                STATUS_TONE[project.status] ?? STATUS_TONE.stopped
              }`}
            >
              {project.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {/* Self-hosted on your own node — not a cloud region. */}
            Self-hosted{project.region ? ` · ${project.region}` : ''} · created{' '}
            {new Date(project.createdAt).toLocaleDateString()}
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{project.slug}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {organization && (
            <Link
              href={`/org/${organization.id}/team`}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Users className="h-4 w-4" /> Team
            </Link>
          )}
          {can('project:update') && (
            <Link
              href={`/dashboard/projects/${project.id}/configure`}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Settings className="h-4 w-4" /> Configure
            </Link>
          )}
          {can('project:deploy') && (
            <button
              onClick={() => void deploy()}
              disabled={busy === 'deploy'}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy === 'deploy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Deploy
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* connection */}
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Database className="h-4 w-4" /> Connection
            </h2>
          </header>
          <div className="space-y-4 px-5 py-4">
            {publicUrl ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">API URL</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                    {publicUrl}
                  </code>
                  <button onClick={() => copy(publicUrl)} className="rounded-md border border-border p-1.5 hover:bg-accent" title="Copy">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : internalUrl ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
                <p className="text-xs font-medium text-amber-300">Not publicly reachable yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This project only listens internally, so this address is not usable from another
                  machine. Set a domain under <span className="text-foreground">Configure</span> to
                  publish an API URL.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {internalUrl}
                  </code>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    host only
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {can('env:read')
                  ? 'No address recorded for this project.'
                  : 'Connection details require the “env:read” permission, which your role does not include.'}
              </p>
            )}

            {keys.map((k) => (
              <div key={k.key}>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{k.key}</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                    {revealed[k.key] ? k.value : '•'.repeat(28)}
                  </code>
                  <button
                    onClick={() => setRevealed((r) => ({ ...r, [k.key]: !r[k.key] }))}
                    className="rounded-md border border-border p-1.5 hover:bg-accent"
                    title={revealed[k.key] ? 'Hide' : 'Reveal'}
                  >
                    {revealed[k.key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => copy(k.value)} className="rounded-md border border-border p-1.5 hover:bg-accent" title="Copy">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {studioHref && can('db:inspect') && (
              <a
                href={studioHref}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-foreground underline"
              >
                <ExternalLink className="h-4 w-4" /> Open Studio
              </a>
            )}
            {!can('db:inspect') && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> Studio requires the “db:inspect” permission.
              </p>
            )}
          </div>
        </section>

        {/* backups */}
        <section className="rounded-xl border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Backups</h2>
            {can('backup:create') && (
              <button
                onClick={() => void backupNow()}
                disabled={busy === 'backup'}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              >
                {busy === 'backup' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Back up now
              </button>
            )}
          </header>
          {!can('backup:read') ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              Your role does not include access to backups.
            </p>
          ) : backups.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No backups yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {backups.slice(0, 6).map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">{b.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.kind} · {humanBytes(b.sizeBytes)} · {new Date(b.createdAt).toLocaleString()}
                      {b.restoreCount > 0 ? ` · restored ${b.restoreCount}×` : ''}
                    </div>
                  </div>
                  {can('backup:restore') && (
                    <button
                      onClick={() => void restore(b.id, b.fileName)}
                      disabled={busy === b.id}
                      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50"
                      title="Restore this backup into this project"
                    >
                      {busy === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {project.description && (
        <section className="mt-6 rounded-xl border border-border bg-card px-5 py-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">About</h2>
          <p className="text-sm text-foreground">{project.description}</p>
        </section>
      )}
    </main>
  )
}
