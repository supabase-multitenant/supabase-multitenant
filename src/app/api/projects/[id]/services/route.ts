import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { recordAudit, requireProjectPermission } from '@/lib/access'
import { getProjectsBasePath } from '@/lib/paths'
import {
  ENABLED_SERVICES_KEY,
  applyServiceGroups,
  groupCatalog,
  parseEnabledGroups,
  serializeEnabledGroups,
} from '@/lib/service-groups'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET: the catalog plus what this project currently wants running. */
export async function GET(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const auth = await requireProjectPermission(request, id, 'project:read')
  if ('response' in auth) return auth.response

  const envVars = await prisma.projectEnvVar.findMany({ where: { projectId: id } })
  const map = Object.fromEntries(envVars.map((e) => [e.key, e.value]))

  let enabled: string[]
  try {
    enabled = parseEnabledGroups(map[ENABLED_SERVICES_KEY])
  } catch (error) {
    // A bad stored value must not make this endpoint unusable — report both.
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Invalid ENABLED_SERVICES value',
        raw: map[ENABLED_SERVICES_KEY] ?? null,
        groups: groupCatalog(),
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ enabled, groups: groupCatalog(), raw: map[ENABLED_SERVICES_KEY] ?? null })
}

/**
 * POST: set the enabled groups and bring the containers in line.
 *
 * Body: { groups: string[] }
 *
 * Stopping a group is a `docker compose stop`, so the containers and their volumes survive and
 * re-enabling is a fast start rather than a rebuild.
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  const auth = await requireProjectPermission(request, id, 'project:deploy')
  if ('response' in auth) return auth.response

  let body: { groups?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.groups) || body.groups.some((g) => typeof g !== 'string')) {
    return NextResponse.json({ error: '`groups` must be an array of strings' }, { status: 400 })
  }

  let serialized: string
  try {
    serialized = serializeEnabledGroups(body.groups as string[])
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid groups' },
      { status: 400 }
    )
  }

  const project = await prisma.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const projectDir = path.join(getProjectsBasePath(), project.slug, 'docker')

  let result
  try {
    result = await applyServiceGroups({
      projectDir,
      groups: parseEnabledGroups(serialized),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to apply service groups' },
      { status: 500 }
    )
  }

  // Only record the change once it actually took effect, so the stored value never claims a state
  // the containers are not in.
  await prisma.projectEnvVar.upsert({
    where: { projectId_key: { projectId: id, key: ENABLED_SERVICES_KEY } },
    create: { projectId: id, key: ENABLED_SERVICES_KEY, value: serialized },
    update: { value: serialized },
  })

  await recordAudit({
    action: 'project.services.update',
    organizationId: auth.project.organizationId,
    actorId: auth.session.user.id,
    actorEmail: auth.session.user.email,
    targetType: 'project',
    targetId: id,
    metadata: { enabled: serialized, ...result },
  })

  return NextResponse.json({
    success: true,
    enabled: parseEnabledGroups(serialized),
    ...result,
  })
}
