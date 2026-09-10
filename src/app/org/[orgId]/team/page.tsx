import { notFound, redirect } from 'next/navigation'
import { AppTopbar } from '@/components/app-topbar'
import { getSessionUser } from '@/lib/auth'
import { loadOrgAccess } from '@/lib/access'
import { prisma } from '@/lib/db'
import { TeamClient } from './team-client'

export const dynamic = 'force-dynamic'

export default async function OrgTeamPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params
  const user = await getSessionUser()
  if (!user) redirect(`/auth/login?next=/org/${orgId}/team`)

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, plan: true, ownerId: true },
  })
  if (!org) notFound()

  const access = await loadOrgAccess(user.id, orgId)
  if (!access) notFound()

  return (
    <div className="min-h-screen bg-background">
      <AppTopbar
        crumbs={[
          { label: 'Organizations', href: '/organizations' },
          { label: org.name, href: `/org/${org.id}` },
          { label: 'Team' },
        ]}
        user={user}
      />
      <TeamClient
        org={{ id: org.id, name: org.name, plan: org.plan }}
        viewerPermissions={access.permissions}
        viewerIsOwner={access.isOwner}
      />
    </div>
  )
}
