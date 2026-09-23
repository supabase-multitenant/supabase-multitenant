import { NextRequest, NextResponse } from 'next/server'
import { deleteProject } from '@/lib/project'
import { recordAudit, requireProjectPermission } from '@/lib/access'
import { prisma } from '@/lib/db'

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

/**
 * Rename a project or change its description.
 *
 * The **slug is deliberately not editable.** Every container in the project's stack is namespaced
 * from the slug (`<slug>-auth`, `<slug>-db`, …), as are its volumes, its compose project name and
 * its directory on disk. Renaming it in place would orphan all of them, so a slug change is a
 * recreate, not an update — and the error says so rather than silently ignoring the field.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const auth = await requireProjectPermission(request, id, 'project:update')
    if (auth.response) return auth.response

    const body = await request.json().catch(() => ({}))

    if (typeof body.slug === 'string' && body.slug !== auth.project.slug) {
      return NextResponse.json(
        {
          error:
            'The project slug cannot be changed: container names, volumes and the project ' +
            'directory are all derived from it. Create a new project instead.',
        },
        { status: 400 }
      )
    }

    const data: { name?: string; description?: string | null } = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (name.length === 0) {
        return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
      }
      data.name = name
    }
    if (typeof body.description === 'string' || body.description === null) {
      data.description = body.description
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const updated = await prisma.project.update({ where: { id }, data })

    await recordAudit({
      action: 'project.update',
      organizationId: auth.project.organizationId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'project',
      targetId: id,
      metadata: { slug: auth.project.slug, fields: Object.keys(data) },
    })

    return NextResponse.json({
      success: true,
      project: { id: updated.id, name: updated.name, description: updated.description },
    })
  } catch (error) {
    console.error('Update project error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
