import { NextRequest, NextResponse } from 'next/server'
import { deleteProject } from '@/lib/project'
import { recordAudit, requireProjectPermission } from '@/lib/access'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    // Deleting a project is `project:delete` — not merely "signed in".
    const auth = await requireProjectPermission(request, id, 'project:delete')
    if (auth.response) return auth.response

    const result = await deleteProject(id)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    await recordAudit({
      action: 'project.delete',
      organizationId: auth.project.organizationId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'project',
      targetId: id,
      metadata: { slug: auth.project.slug, name: auth.project.name },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete project error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
