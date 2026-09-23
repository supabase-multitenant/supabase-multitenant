import { NextRequest, NextResponse } from 'next/server'
import { pauseProject } from '@/lib/project'
import { recordAudit, requireProjectPermission } from '@/lib/access'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * Pause a project: stop its containers so it stops consuming resources, keep every volume.
 *
 * This is the resource-saving primitive (ADR-0003). `docker compose stop` leaves the containers,
 * their networks, volumes and ports in place, so nothing has to be rebuilt to bring the project
 * back — that is what makes resume fast. Data is untouched: a paused project is dormant, not
 * deleted, and must never be treated as abandoned by cleanup.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    // Lifecycle control, same permission as deploy/restart — a viewer must not stop a project.
    const auth = await requireProjectPermission(request, id, 'project:deploy')
    if (auth.response) return auth.response

    const result = await pauseProject(id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    await recordAudit({
      action: 'project.pause',
      organizationId: auth.project.organizationId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'project',
      targetId: id,
      metadata: { slug: auth.project.slug, name: auth.project.name },
    })

    return NextResponse.json({ success: true, status: 'paused' })
  } catch (error) {
    console.error('Pause project error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
