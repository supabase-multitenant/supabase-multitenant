import { notFound, redirect } from 'next/navigation'

import { AppTopbar } from '@/components/app-topbar'
import { getSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isSystemAdmin } from '@/lib/system-admin'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'System administration',
  description: 'Every account, organization and project on this platform.',
}

/**
 * The system view (#139).
 *
 * This is the one screen that is not scoped to an organization, and it is gated accordingly: the
 * role is re-read from `users.role` on every request rather than taken from the session token, so a
 * demotion takes effect immediately instead of when the token happens to expire.
 *
 * A non-administrator gets a 404 rather than a 403. There is no reason to confirm to someone outside
 * the system that this page exists, and "not found" is also what a signed-out stranger sees.
 */
export default async function AdminPage() {
  const user = await getSessionUser()
  if (!user) redirect('/auth/login?next=/admin')

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true, disabled: true },
  })
  if (!record || record.disabled) notFound()
  if (!isSystemAdmin(record.role)) notFound()

  const [users, organizations, projects] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        disabled: true,
        createdAt: true,
        _count: { select: { projects: true, organizations: true } },
      },
    }),
    prisma.organization.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        type: true,
        createdAt: true,
        owner: { select: { email: true } },
        _count: { select: { projects: true, members: true } },
      },
    }),
    prisma.project.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        region: true,
        createdAt: true,
        owner: { select: { email: true } },
        organization: { select: { name: true, slug: true } },
        _count: { select: { envVars: true } },
      },
    }),
  ])

  const byStatus = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1
    return acc
  }, {})

  const stat = (label: string, value: number | string, note?: string) => (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {note ? <div className="mt-1 text-xs text-muted-foreground">{note}</div> : null}
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <AppTopbar crumbs={[{ label: 'System administration' }]} user={user} />

      <main className="mx-auto max-w-6xl space-y-10 px-6 py-8">
        <section>
          <h1 className="text-xl font-semibold">Platform</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything below is unscoped — this is the only place that is true.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stat('Accounts', users.length, `${users.filter((u) => u.disabled).length} disabled`)}
            {stat('Organizations', organizations.length)}
            {stat('Projects', projects.length)}
            {stat(
              'By status',
              Object.entries(byStatus)
                .map(([k, v]) => `${k} ${v}`)
                .join(' · ') || '—'
            )}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Accounts</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">System role</th>
                  <th className="px-3 py-2">Orgs</th>
                  <th className="px-3 py-2">Projects</th>
                  <th className="px-3 py-2">Since</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      {u.email}
                      {u.disabled ? <span className="ml-2 text-xs text-red-500">disabled</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {isSystemAdmin(u.role) ? (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-600">
                          {u.role}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{u.role}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{u._count.organizations}</td>
                    <td className="px-3 py-2">{u._count.projects}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {u.createdAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Organizations</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Slug</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Members</th>
                  <th className="px-3 py-2">Projects</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="px-3 py-2">{o.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{o.slug}</td>
                    <td className="px-3 py-2">{o.plan}</td>
                    <td className="px-3 py-2 text-muted-foreground">{o.owner.email}</td>
                    <td className="px-3 py-2">{o._count.members + 1}</td>
                    <td className="px-3 py-2">{o._count.projects}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Projects</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A project with no organization is listed as unattached — that state exists in the data and
            hiding it would make the count above lie.
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Organization</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Region</th>
                  <th className="px-3 py-2">Env vars</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      {p.name}
                      <div className="font-mono text-xs text-muted-foreground">{p.slug}</div>
                    </td>
                    <td className="px-3 py-2">{p.status}</td>
                    <td className="px-3 py-2">
                      {p.organization ? (
                        p.organization.name
                      ) : (
                        <span className="text-amber-600">unattached</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{p.owner.email}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.region ?? '—'}</td>
                    <td className="px-3 py-2">{p._count.envVars}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
