import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createProject } from '@/lib/project'
import {
  listAccessibleOrganizationIds,
  recordAudit,
  requireOrgPermission,
} from '@/lib/access'
import { getSession, unauthorized } from '@/lib/api-auth'

/**
 * Projects.
 *
 * Both verbs are scoped to what the caller may actually see or do: the list is
 * filtered to their organizations, and creating one requires `project:create`
 * on the target organization rather than merely being signed in.
 */

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) return unauthorized()

    const organizationIds = await listAccessibleOrganizationIds(session.user.id)

    const projects = await prisma.project.findMany({
      where: {
        OR: [
          // Projects without an organization belong to their creator.
          { ownerId: session.user.id },
          ...(organizationIds.length > 0 ? [{ organizationId: { in: organizationIds } }] : []),
        ],
      },
      // Deliberately not including envVars: this list must never carry secrets.
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        region: true,
        status: true,
        domain: true,
        domainVerified: true,
        studioDomain: true,
        studioDomainVerified: true,
        organizationId: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ projects })
  } catch (error) {
    console.error('List projects error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) return unauthorized()

    const { name, description = '', organizationId, region, databasePassword } = await request.json()

    if (!name) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
    }

    // Creating inside an organization requires the permission there; a project
    // created outside any organization is only ever the creator's own.
    if (organizationId) {
      const auth = await requireOrgPermission(request, organizationId, 'project:create')
      if (auth.response) return auth.response
    }

    const result = await createProject(name, session.user.id, description, {
      organizationId,
      region,
      databasePassword,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    await recordAudit({
      action: 'project.create',
      organizationId: organizationId ?? null,
      actorId: session.user.id,
      actorEmail: session.user.email,
      targetType: 'project',
      targetId: (result.project as { id?: string } | undefined)?.id ?? null,
      metadata: { name, region: region ?? null },
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Create project error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
