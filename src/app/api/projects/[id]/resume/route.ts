import { NextRequest, NextResponse } from 'next/server'
import { resumeProject } from '@/lib/project'
import { recordAudit, requireProjectPermission } from '@/lib/access'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * Resume a paused project.
 *
 * Starts the existing containers rather than rebuilding the stack, so this is a start and not a
 * redeploy. The project keeps its slug, host and data throughout, which is why a paused tenant
 * still holds its route reservation.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const auth = await requireProjectPermission(request, id, 'project:deploy')
    if (auth.response) return auth.response

    const result = await resumeProject(id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    await recordAudit({
      action: 'project.resume',
      organizationId: auth.project.organizationId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'project',
      targetId: id,
      metadata: { slug: auth.project.slug, name: auth.project.name },
    })

    return NextResponse.json({ success: true, status: 'active' })
  } catch (error) {
    console.error('Resume project error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
