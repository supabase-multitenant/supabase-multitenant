'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, Loader2, Pencil, Plus, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react'

import { PERMISSION_CATALOG, hasPermission, permissionsByGroup, type Permission } from '@/lib/authz'

type Member = {
  id: string
  userId: string
  email: string
  name: string | null
  role: string
  roleLabel: string
  customRole: { id: string; name: string; permissions: string[] } | null
  joinedAt: string
  isOwner: boolean
  permissions: string[]
}

type CustomRole = {
  id: string
  name: string
  description: string | null
  permissions: string[]
  memberCount: number
}

type AssignableRole = { value: string; label: string; description: string }

const ROLE_TONE: Record<string, string> = {
  owner: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  admin: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  developer: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  member: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  viewer: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
}

export function TeamClient({
  org,
  viewerPermissions,
  viewerIsOwner,
}: {
  org: { id: string; name: string; plan: string }
  viewerPermissions: string[]
  viewerIsOwner: boolean
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [owner, setOwner] = useState<Member | null>(null)
  const [roles, setRoles] = useState<CustomRole[]>([])
  const [assignable, setAssignable] = useState<AssignableRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const mine = useMemo(() => viewerPermissions as Permission[], [viewerPermissions])
  const allowed = useCallback((p: Permission) => hasPermission(mine, p), [mine])

  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState('viewer')
  const [busy, setBusy] = useState<string | null>(null)

  const [showCreateRole, setShowCreateRole] = useState(false)
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null)
  const [roleName, setRoleName] = useState('')
  const [roleDescription, setRoleDescription] = useState('')
  const [rolePerms, setRolePerms] = useState<Set<string>>(new Set())

  const groups = useMemo(() => permissionsByGroup(), [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [mRes, rRes] = await Promise.all([
        fetch(`/api/organizations/${org.id}/members`, { cache: 'no-store' }),
        fetch(`/api/organizations/${org.id}/roles`, { cache: 'no-store' }),
      ])
      const mJson = await mRes.json()
      const rJson = await rRes.json()
      if (!mRes.ok) throw new Error(mJson.error ?? 'Could not load members.')
      setMembers(mJson.members ?? [])
      setOwner(mJson.owner ?? null)
      setAssignable(mJson.assignableRoles ?? [])
      if (rRes.ok) setRoles(rJson.roles ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }, [org.id])

  useEffect(() => {
    void load()
  }, [load])

  async function changeRole(member: Member, role: string) {
    setBusy(member.id)
    setError(null)
    try {
      const res = await fetch(`/api/organizations/${org.id}/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, customRoleId: null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail ? `${json.error} ${json.detail}` : json.error)
      setNotice(`${member.email} is now ${json.roleLabel}.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the role.')
    } finally {
      setBusy(null)
    }
  }

  async function assignCustomRole(member: Member, customRoleId: string) {
    setBusy(member.id)
    setError(null)
    try {
      const res = await fetch(`/api/organizations/${org.id}/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customRoleId: customRoleId || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail ? `${json.error} ${json.detail}` : json.error)
      setNotice(`Access updated for ${member.email}.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign the role.')
    } finally {
      setBusy(null)
    }
  }

  async function removeMember(member: Member) {
    if (!confirm(`Remove ${member.email} from ${org.name}?`)) return
    setBusy(member.id)
    setError(null)
    try {
      const res = await fetch(`/api/organizations/${org.id}/members/${member.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setNotice(`${member.email} removed.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the member.')
    } finally {
      setBusy(null)
    }
  }

  async function addMember() {
    if (!email.trim()) return
    setBusy('add')
    setError(null)
    try {
      const res = await fetch(`/api/organizations/${org.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role: newRole }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.hint ? `${json.error} ${json.hint}` : json.error)
      setNotice(`${email.trim()} added as ${newRole}.`)
      setEmail('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the member.')
    } finally {
      setBusy(null)
    }
  }

  function openCreateRole() {
    setEditingRole(null)
    setRoleName('')
    setRoleDescription('')
    setRolePerms(new Set(['project:read', 'db:inspect']))
    setShowCreateRole(true)
  }

  function openEditRole(role: CustomRole) {
    setEditingRole(role)
    setRoleName(role.name)
    setRoleDescription(role.description ?? '')
    setRolePerms(new Set(role.permissions))
    setShowCreateRole(true)
  }

  async function saveRole() {
    setBusy('role')
    setError(null)
    const payload = {
      name: roleName.trim(),
      description: roleDescription.trim(),
      permissions: [...rolePerms],
    }
    try {
      const res = await fetch(
        editingRole
          ? `/api/organizations/${org.id}/roles/${editingRole.id}`
          : `/api/organizations/${org.id}/roles`,
        {
          method: editingRole ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail ? `${json.error} ${json.detail}` : json.error)
      setNotice(editingRole ? `Role "${payload.name}" updated.` : `Role "${payload.name}" created.`)
      setShowCreateRole(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the role.')
    } finally {
      setBusy(null)
    }
  }

  async function deleteRole(role: CustomRole) {
    if (!confirm(`Delete the role "${role.name}"?`)) return
    setBusy(role.id)
    setError(null)
    try {
      const res = await fetch(`/api/organizations/${org.id}/roles/${role.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setNotice(`Role "${role.name}" deleted.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the role.')
    } finally {
      setBusy(null)
    }
  }

  function togglePerm(permission: string) {
    setRolePerms((prev) => {
      const next = new Set(prev)
      if (next.has(permission)) next.delete(permission)
      else next.add(permission)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Team &amp; access</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who can do what in <span className="font-medium text-foreground">{org.name}</span>.
          </p>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link href={`/org/${org.id}`} className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground">
            Projects
          </Link>
          <span className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-foreground">Team</span>
        </nav>
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

      {/* ---------------------------------------------------------------- */}
      {/* Members                                                           */}
      {/* ---------------------------------------------------------------- */}
      <section className="mb-10 rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Members</h2>
          <span className="text-xs text-muted-foreground">{members.length + (owner ? 1 : 0)} total</span>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
          </div>
        ) : (
          <div className="divide-y divide-border">
            {owner && (
              <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{owner.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {owner.name ?? '—'} · joined {new Date(owner.joinedAt).toLocaleDateString()}
                  </div>
                </div>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_TONE.owner}`}>Owner</span>
                <span className="text-xs text-muted-foreground">{owner.permissions.length} permissions</span>
                <span className="text-xs text-muted-foreground">Cannot be changed</span>
              </div>
            )}

            {members.map((member) => (
              <div key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{member.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {member.name ?? '—'} · joined {new Date(member.joinedAt).toLocaleDateString()}
                  </div>
                </div>

                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_TONE[member.role] ?? ROLE_TONE.viewer}`}>
                  {member.customRole ? member.customRole.name : member.roleLabel}
                </span>
                <span className="text-xs text-muted-foreground">{member.permissions.length} permissions</span>

                {allowed('member:update') ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={member.customRole ? `custom:${member.customRole.id}` : member.role}
                      disabled={busy === member.id}
                      onChange={(e) => {
                        const value = e.target.value
                        if (value.startsWith('custom:')) void assignCustomRole(member, value.slice(7))
                        else void changeRole(member, value)
                      }}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
                    >
                      {assignable.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                      {roles.length > 0 && <option disabled>──────────</option>}
                      {roles.map((r) => (
                        <option key={r.id} value={`custom:${r.id}`}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {allowed('member:remove') ? (
                  <button
                    onClick={() => void removeMember(member)}
                    disabled={busy === member.id}
                    className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                    title="Remove from organization"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}

            {members.length === 0 && (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Just you so far. Add a teammate below, or create a custom role first.
              </p>
            )}
          </div>
        )}

        {allowed('member:invite') && (
          <footer className="flex flex-wrap items-end gap-3 border-t border-border px-5 py-4">
            <label className="min-w-[220px] flex-1">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Access level</span>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {assignable.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => void addMember()}
              disabled={busy === 'add' || !email.trim()}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Add member
            </button>
            <p className="w-full text-xs text-muted-foreground">
              The person needs an account already. Invitation links for new people are not built yet.
            </p>
          </footer>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Custom roles                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Custom roles</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Define exactly what someone can do, on top of the built-in levels.
            </p>
          </div>
          {allowed('role:manage') && (
            <button
              onClick={openCreateRole}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Plus className="h-4 w-4" /> New role
            </button>
          )}
        </header>

        {roles.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No custom roles yet. Built-in levels are Viewer, Developer, Administrator and Owner.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {roles.map((role) => (
              <div key={role.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{role.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {role.permissions.length} permissions · {role.memberCount} member(s)
                    </span>
                  </div>
                  {role.description && <p className="mt-1 text-xs text-muted-foreground">{role.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {role.permissions.slice(0, 8).map((p) => (
                      <span key={p} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {PERMISSION_CATALOG[p as Permission]?.label ?? p}
                      </span>
                    ))}
                    {role.permissions.length > 8 && (
                      <span className="px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        +{role.permissions.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
                {allowed('role:manage') && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditRole(role)}
                      className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
                      title="Edit role"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => void deleteRole(role)}
                      disabled={busy === role.id}
                      className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                      title="Delete role"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {showCreateRole && (
          <div className="border-t border-border px-5 py-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {editingRole ? `Edit "${editingRole.name}"` : 'New custom role'}
              </h3>
              <button onClick={() => setShowCreateRole(false)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
                <input
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="e.g. Staging engineer"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Description (optional)</span>
                <input
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                  placeholder="What is this role for?"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>

            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.group}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.group}
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {group.permissions.map((permission) => {
                      const grantable = allowed('role:manage') && mine.includes(permission)
                      const meta = PERMISSION_CATALOG[permission]
                      return (
                        <label
                          key={permission}
                          className={`flex items-start gap-2 rounded-md border border-border px-3 py-2 text-xs ${
                            grantable ? 'cursor-pointer hover:bg-accent' : 'opacity-50'
                          }`}
                          title={grantable ? undefined : 'You do not hold this permission yourself, so you cannot grant it.'}
                        >
                          <input
                            type="checkbox"
                            disabled={!grantable}
                            checked={rolePerms.has(permission)}
                            onChange={() => togglePerm(permission)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-foreground">{meta.label}</span>
                            <span className="block text-muted-foreground">{permission}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={() => void saveRole()}
                disabled={busy === 'role' || !roleName.trim() || rolePerms.size === 0}
                className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy === 'role' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {editingRole ? 'Save changes' : 'Create role'}
              </button>
              <span className="text-xs text-muted-foreground">{rolePerms.size} permission(s) selected</span>
            </div>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        You are signed in as a{' '}
        {viewerIsOwner ? 'Owner' : 'member'} with {mine.length} permission(s). Actions you cannot perform are hidden.
      </p>
    </div>
  )
}
