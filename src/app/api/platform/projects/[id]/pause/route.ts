import { NextRequest, NextResponse } from 'next/server'
import { apiTokenErrorResponse, requirePlatformAccess } from '@/lib/api-tokens'
import { prisma } from '@/lib/db'
import { pauseProject } from '@/lib/project'

/** Token twin of the session route: pause a project (slug or id), data and volumes untouched. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAccess(request, 'admin')
    const { id } = await ctx.params
    const project = await prisma.project.findFirst({ where: { OR: [{ slug: id }, { id }] } })
    if (!project) return NextResponse.json({ error: 'No such project' }, { status: 404 })

    const result = await pauseProject(project.id)
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 })

    await prisma.auditLog
      .create({
        data: {
          action: 'platform.project.pause',
          targetType: 'project',
          targetId: project.id,
          actorId: actor.userId,
          actorEmail: actor.email,
          metadata: { slug: project.slug, via: actor.kind },
        },
      })
      .catch(() => undefined)
    return NextResponse.json({ success: true, status: 'paused' })
  } catch (error) {
    return apiTokenErrorResponse(error)
  }
}
