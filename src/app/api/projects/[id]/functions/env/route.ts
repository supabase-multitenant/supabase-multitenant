import { NextRequest, NextResponse } from 'next/server'
import { updateFunctionSecrets } from '@/lib/project'
import { InvalidFunctionSecretError, validateFunctionSecrets } from '@/lib/function-secrets'
import { prisma } from '@/lib/db'
import { recordAudit, requireProjectPermission } from '@/lib/access'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * Edge-function secrets: env vars exposed only to this project's edge functions
 * (via docker/.env.functions). Reading reveals secret values, so it is gated by
 * `env:read` — the same distinction the project env route makes.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const auth = await requireProjectPermission(request, id, 'env:read')
    if (auth.response) return auth.response

    const secrets = await prisma.projectFunctionSecret.findMany({
      where: { projectId: id },
    })

    const envVars: Record<string, string> = {}
    secrets.forEach((secret) => {
      envVars[secret.key] = secret.value
    })

    return NextResponse.json({ envVars })
  } catch (error) {
    console.error('Get function secrets error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const auth = await requireProjectPermission(request, id, 'env:write')
    if (auth.response) return auth.response

    const secrets = await request.json()

    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
      return NextResponse.json({ error: 'Invalid function secrets' }, { status: 400 })
    }

    try {
      validateFunctionSecrets(secrets)
    } catch (error) {
      if (error instanceof InvalidFunctionSecretError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }

    const result = await updateFunctionSecrets(id, secrets)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    await recordAudit({
      // Names only — never the values.
      action: 'project.function_env_write',
      organizationId: auth.project.organizationId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'project',
      targetId: id,
      metadata: { keys: Object.keys(secrets) },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Update function secrets error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
