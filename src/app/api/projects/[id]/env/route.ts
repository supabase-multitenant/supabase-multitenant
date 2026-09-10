import { NextRequest, NextResponse } from 'next/server'
import { updateProjectEnvVars } from '@/lib/project'
import { prisma } from '@/lib/db'
import { recordAudit, requireProjectPermission } from '@/lib/access'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * Environment variables, which include the project's API keys.
 *
 * Reading them is `env:read` — a distinct permission precisely because it
 * exposes secrets: a viewer can inspect a project without being able to drain
 * its service-role key.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const auth = await requireProjectPermission(request, id, 'env:read')
    if (auth.response) return auth.response

    const envVars = await prisma.projectEnvVar.findMany({
      where: { projectId: id }
    })

    const envVarsObject: Record<string, string> = {}
    envVars.forEach(envVar => {
      envVarsObject[envVar.key] = envVar.value
    })

    return NextResponse.json({ envVars: envVarsObject })
  } catch (error) {
    console.error('Get env vars error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const auth = await requireProjectPermission(request, id, 'env:write')
    if (auth.response) return auth.response

    const envVars = await request.json()

    if (!envVars || typeof envVars !== 'object') {
      return NextResponse.json(
        { error: 'Invalid environment variables' },
        { status: 400 }
      )
    }

    const result = await updateProjectEnvVars(id, envVars)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    await recordAudit({
      // Names only — never the values.
      action: 'project.env_write',
      organizationId: auth.project.organizationId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'project',
      targetId: id,
      metadata: { keys: Object.keys(envVars) },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Update env vars error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
