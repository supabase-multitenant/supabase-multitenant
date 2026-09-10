import { redirect } from 'next/navigation'
import { AppTopbar } from '@/components/app-topbar'
import { getSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { OrgsClient } from './orgs-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Your organizations',
  description: 'Browse, search and create organizations to group your projects.',
}

export default async function OrganizationsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/auth/login?next=/organizations')

  const organizations = await prisma.organization.findMany({
    where: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { projects: true, members: true } } },
  })

  return (
    <div className="min-h-screen bg-background">
      <AppTopbar crumbs={[{ label: 'Organizations' }]} user={user} />
      <OrgsClient
        initial={organizations.map((o) => ({
          id: o.id,
          name: o.name,
          type: o.type,
          projectCount: o._count.projects,
          // The org owner is not a membership row, so count them too.
          memberCount: o._count.members + 1,
        }))}
      />
    </div>
  )
}
