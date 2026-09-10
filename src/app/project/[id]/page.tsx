import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppTopbar } from '@/components/app-topbar'
import { getSessionUser } from '@/lib/auth'
import { ORG_PERMISSIONS, hasPermission, type Permission } from '@/lib/authz'
import { loadOrgAccess, type OrgAccess } from '@/lib/access'
import { prisma } from '@/lib/db'
import { listBackups } from '@/lib/backup'
import { ProjectClient } from './project-client'

export const dynamic = 'force-dynamic'

/**
 * Project overview — the page the organization list links to.
 *
 * Everything shown is gated by the permission that governs it: the API keys
 * require `env:read`, the Studio link requires `db:inspect`, the backups
 * require `backup:read`. A viewer sees the project and its status, not its
 * secrets.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getSessionUser()
  if (!user) redirect(`/auth/login?next=/project/${id}`)

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      region: true,
      domain: true,
      domainVerified: true,
      studioDomain: true,
      createdAt: true,
      organizationId: true,
      ownerId: true,
    },
  })
  if (!project) notFound()

  // Resolve the caller's access to whichever scope owns this project.
  const access: OrgAccess | null = project.organizationId
    ? await loadOrgAccess(user.id, project.organizationId)
    : project.ownerId === user.id
      ? {
          organizationId: '',
          role: 'owner',
          customRoleId: null,
          customRoleName: null,
          permissions: [...ORG_PERMISSIONS],
          isOwner: true,
        }
      : null
  if (!access) notFound()

  const permissions = access.permissions
  const can = (permission: Permission) => hasPermission(permissions, permission)

  const organization = project.organizationId
    ? await prisma.organization.findUnique({
        where: { id: project.organizationId },
        select: { id: true, name: true },
      })
    : null

  // Each section is fetched only if the caller may see it at all.
  const backups = can('backup:read') ? await listBackups(id) : []

  /**
   * Only these two keys are ever surfaced. Everything else in a project's env
   * (database password, JWT secret, Studio dashboard password, SMTP credentials)
   * stays out of the UI entirely rather than relying on a mask.
   */
  const keys = can('env:read')
    ? await prisma.projectEnvVar.findMany({
        where: { projectId: id, key: { in: ['ANON_KEY', 'SERVICE_ROLE_KEY'] } },
        select: { key: true, value: true },
        orderBy: { key: 'asc' },
      })
    : []

  /**
   * Is this an address only reachable from the host itself?
   *
   * `project.domain` is the admin-configured public host. The stored
   * SUPABASE_PUBLIC_URL is the *internal* one and points at localhost, so it
   * must never be presented as the project's API URL to someone who wants to
   * connect an app to it.
   */
  const isLocalAddress = (value: string | null) =>
    !!value && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(value)

  const storedPublicUrl = can('env:read')
    ? ((
        await prisma.projectEnvVar.findFirst({
          where: { projectId: id, key: 'SUPABASE_PUBLIC_URL' },
          select: { value: true },
        })
      )?.value ?? null)
    : null

  const configuredDomain = project.domain ? `https://${project.domain}` : null
  const publicUrl =
    configuredDomain ?? (isLocalAddress(storedPublicUrl) ? null : storedPublicUrl)
  const internalUrl = isLocalAddress(storedPublicUrl) ? storedPublicUrl : null

  const panelHost =
    process.env.AUTH_URL?.replace(/^https?:\/\//, '').replace(/\/+$/, '') ?? null

  return (
    <div className="min-h-screen bg-background">
      <AppTopbar
        crumbs={[
          { label: 'Organizations', href: '/organizations' },
          ...(organization ? [{ label: organization.name, href: `/org/${organization.id}` }] : []),
          { label: project.name },
        ]}
        user={user ?? undefined}
      />
      <ProjectClient
        project={{
          id: project.id,
          name: project.name,
          slug: project.slug,
          description: project.description,
          status: project.status,
          region: project.region,
          domain: project.domain,
          domainVerified: project.domainVerified,
          studioDomain: project.studioDomain,
          createdAt: project.createdAt.toISOString(),
        }}
        organization={organization}
        permissions={permissions as string[]}
        studioBaseUrl={panelHost ? `https://${panelHost}` : null}
        publicUrl={publicUrl}
        internalUrl={internalUrl}
        keys={keys}
        backups={backups.map((b) => ({
          id: b.id,
          kind: b.kind,
          status: b.status,
          fileName: b.fileName,
          sizeBytes: b.sizeBytes,
          createdAt: b.createdAt,
          restoreCount: b.restoreCount,
        }))}
      />
      <p className="mx-auto max-w-5xl px-6 pb-10 text-xs text-muted-foreground">
        Signed in as {user.email} with {permissions.length} permission(s).{' '}
        <Link href={organization ? `/org/${organization.id}/team` : '/organizations'} className="underline">
          Manage access
        </Link>
      </p>
    </div>
  )
}
