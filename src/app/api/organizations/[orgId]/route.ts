import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { deleteProject } from '@/lib/project'
import { recordAudit, requireOrgPermission } from '@/lib/access'

interface RouteContext {
  params: Promise<{
    orgId: string
  }>
}

/**
 * A single organization.
 *
 * GET    /api/organizations/[orgId]  -> the organization, with counts
 * PATCH  /api/organizations/[orgId]  -> rename / change plan
 * DELETE /api/organizations/[orgId]  -> delete it, and its projects
 */

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { orgId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'org:read')
    if (auth.response) return auth.response

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: { _count: { select: { projects: true, members: true } } },
    })
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

    const projects = await prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, slug: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({
      organization: {
        id: org.id,
        slug: org.slug,
        name: org.name,
        plan: org.plan,
        type: org.type,
        projectCount: org._count.projects,
        memberCount: org._count.members,
      },
      projects,
    })
  } catch (error) {
    console.error('Get organization error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { orgId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'org:update')
    if (auth.response) return auth.response

    const body = await request.json().catch(() => ({}))
    const data: { name?: string; plan?: string } = {}

    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (name.length === 0) {
        return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
      }
      data.name = name
    }
    if (typeof body.plan === 'string') data.plan = body.plan

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const updated = await prisma.organization.update({ where: { id: orgId }, data })

    await recordAudit({
      action: 'organization.update',
      organizationId: orgId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'organization',
      targetId: orgId,
      metadata: { fields: Object.keys(data) },
    })

    return NextResponse.json({
      success: true,
      organization: { id: updated.id, name: updated.name, plan: updated.plan },
    })
  } catch (error) {
    console.error('Update organization error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Delete an organization, and the projects inside it.
 *
 * ## Why this refuses by default
 *
 * `Project.organizationId` is `onDelete: SetNull`, so deleting the organization row does **not**
 * delete its projects — it orphans them. Their containers, volumes, Traefik routes and directories
 * on disk would keep running with nothing in the panel pointing at them: resources consumed, and
 * no way to find them from the UI. Silently leaking a few full Supabase stacks is a far worse
 * failure than refusing.
 *
 * So a non-empty organization requires an explicit `?force=true`, and even then the projects are
 * torn down through the normal `deleteProject` path (compose down --volumes, Traefik removal,
 * directory removal) before the organization row goes. Nothing is left behind, and the caller has
 * to have said so on purpose.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { orgId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'org:delete')
    if (auth.response) return auth.response

    const projects = await prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, slug: true },
    })

    const force = new URL(request.url).searchParams.get('force') === 'true'

    if (projects.length > 0 && !force) {
      return NextResponse.json(
        {
          error:
            `This organization still has ${projects.length} project(s). Deleting it would orphan ` +
            `them — their containers, volumes and data would keep running with nothing pointing ` +
            `at them. Re-run with ?force=true to delete the projects as well.`,
          projects: projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
        },
        { status: 409 }
      )
    }

    const tornDown: string[] = []
    const failed: Array<{ slug: string; error: string }> = []

    for (const project of projects) {
      const result = await deleteProject(project.id)
      if (result.success) {
        tornDown.push(project.slug)
      } else {
        // Do not delete the organization if any project could not be removed — that is exactly
        // how orphaned resources appear.
        failed.push({ slug: project.slug, error: result.error ?? 'unknown error' })
      }
    }

    if (failed.length > 0) {
      return NextResponse.json(
        {
          error:
            'Refusing to delete the organization: some projects could not be removed, so ' +
            'deleting it would orphan them.',
          tornDown,
          failed,
        },
        { status: 500 }
      )
    }

    await prisma.organization.delete({ where: { id: orgId } })

    await recordAudit({
      action: 'organization.delete',
      organizationId: orgId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'organization',
      targetId: orgId,
      metadata: { forced: force, projectsDeleted: tornDown },
    })

    return NextResponse.json({ success: true, projectsDeleted: tornDown })
  } catch (error) {
    console.error('Delete organization error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
