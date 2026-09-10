import { notFound, redirect } from 'next/navigation'
import { AppTopbar } from '@/components/app-topbar'
import { getSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { OrgProjects } from './projects-client'

export const dynamic = 'force-dynamic'

export default async function OrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params
  const user = await getSessionUser()
  if (!user) redirect(`/auth/login?next=/org/${orgId}`)

  const org = await prisma.organization.findFirst({
    where: { id: orgId, OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    include: {
      projects: { orderBy: { createdAt: 'desc' } },
      _count: { select: { members: true } },
    },
  })
  if (!org) notFound()

  return (
    <div className="min-h-screen bg-background">
      <AppTopbar
        crumbs={[
          { label: 'Organizations', href: '/organizations' },
          { label: org.name },
        ]}
        user={user}
      />
      <OrgProjects
        org={{ id: org.id, name: org.name }}
        // +1 for the owner, who is not a membership row.
        memberCount={org._count.members + 1}
        initial={org.projects.map((p) => ({
          id: p.id,
          name: p.name,
          region: p.region ?? 'eu-central-1',
          status: p.status,
        }))}
      />
    </div>
  )
}
