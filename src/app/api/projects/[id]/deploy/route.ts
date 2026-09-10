import { NextRequest, NextResponse } from 'next/server'
import { deployProject } from '@/lib/project'
import { recordAudit, requireProjectPermission } from '@/lib/access'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    // `project:deploy` — a developer can deploy; a viewer cannot.
    const auth = await requireProjectPermission(request, id, 'project:deploy')
    if (auth.response) return auth.response

    const result = await deployProject(id)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    await recordAudit({
      action: 'project.deploy',
      organizationId: auth.project.organizationId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'project',
      targetId: id,
      metadata: { slug: auth.project.slug },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Deploy project error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
