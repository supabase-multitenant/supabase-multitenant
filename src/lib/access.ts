import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './db'
import { getSession, unauthorized, notFound, type Session } from './api-auth'
import {
  ALL_PERMISSIONS,
  hasPermission,
  resolveEffectivePermissions,
  type Permission,
} from './authz'

/**
 * Resolving "may this user do this?" and recording what they did.
 *
 * Every route enforces permissions through here rather than comparing roles at
 * the call site, so custom (admin-defined) roles work everywhere without special
 * cases.
 */

export interface OrgAccess {
  organizationId: string
  role: string
  customRoleId: string | null
  customRoleName: string | null
  permissions: Permission[]
  isOwner: boolean
}

export interface ProjectAccess {
  project: { id: string; slug: string; name: string; status: string; organizationId: string | null }
  access: OrgAccess
}

/** Permissions for an organization member, or null when they have no access. */
export async function loadOrgAccess(userId: string, organizationId: string): Promise<OrgAccess | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, ownerId: true },
  })
  if (!organization) return null

  // The org owner always has full control, membership row or not.
  if (organization.ownerId === userId) {
    return {
      organizationId,
      role: 'owner',
      customRoleId: null,
      customRoleName: null,
      permissions: [...ALL_PERMISSIONS],
      isOwner: true,
    }
  }

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { customRole: { select: { id: true, name: true, permissions: true } } },
  })
  if (!membership) return null

  return {
    organizationId,
    role: membership.role,
    customRoleId: membership.customRoleId,
    customRoleName: membership.customRole?.name ?? null,
    permissions: resolveEffectivePermissions({
      role: membership.role,
      customPermissions: membership.customRole?.permissions ?? null,
    }),
    isOwner: false,
  }
}

export type AccessFailure = { response: NextResponse }

/** Success shape carries `response?: never` so `if (auth.response)` narrows. */
type OrgAccessSuccess = OrgAccess & { session: NonNullable<Session>; response?: never }
type ProjectAccessSuccess = ProjectAccess & { session: NonNullable<Session>; response?: never }

export function forbidden(permission?: Permission): NextResponse {
  return NextResponse.json(
    {
      error: 'Forbidden',
      ...(permission
        ? { detail: `Your role does not include the "${permission}" permission.` }
        : {}),
    },
    { status: 403 }
  )
}

/** Session + organization + the permission check, in that order. */
export async function requireOrgPermission(
  request: NextRequest,
  organizationId: string,
  permission: Permission
): Promise<OrgAccessSuccess | AccessFailure> {
  const session = await getSession(request)
  if (!session) return { response: unauthorized() }

  const access = await loadOrgAccess(session.user.id, organizationId)
  if (!access) return { response: notFound('Organization') }

  if (!hasPermission(access.permissions, permission)) {
    return { response: forbidden(permission) }
  }

  return { ...access, session }
}

/**
 * Project-scoped check.
 *
 * A project that belongs to an organization inherits that organization's access
 * rules. A project with no organization (created before organizations existed)
 * is reachable only by its owner, who is treated as owner of it.
 */
export async function requireProjectPermission(
  request: NextRequest,
  projectId: string,
  permission: Permission
): Promise<ProjectAccessSuccess | AccessFailure> {
  const session = await getSession(request)
  if (!session) return { response: unauthorized() }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, name: true, status: true, organizationId: true, ownerId: true },
  })
  if (!project) return { response: notFound('Project') }

  if (!project.organizationId) {
    if (project.ownerId !== session.user.id) return { response: forbidden(permission) }
    return {
      project: { ...project },
      access: {
        organizationId: '',
        role: 'owner',
        customRoleId: null,
        customRoleName: null,
        permissions: [...ALL_PERMISSIONS],
        isOwner: true,
      },
      session,
    }
  }

  const access = await loadOrgAccess(session.user.id, project.organizationId)
  if (!access) return { response: forbidden(permission) }
  if (!hasPermission(access.permissions, permission)) {
    return { response: forbidden(permission) }
  }

  return { project: { ...project }, access, session }
}

/**
 * Panel-wide guard.
 *
 * Some settings are not scoped to an organization at all — the panel's own
 * domain changes how the host routes traffic, and bootstrapping the Supabase
 * core touches the machine itself. Those belong to the panel owner
 * (`User.role === 'owner'`), not to whoever administers one organization.
 */
export async function requirePanelOwner(
  request: NextRequest
): Promise<{ session: NonNullable<Session>; response?: never } | AccessFailure> {
  const session = await getSession(request)
  if (!session) return { response: unauthorized() }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (user?.role !== 'owner') return { response: forbidden('system:manage') }

  return { session }
}

/**
 * Append to the audit trail. Best-effort: a logging failure must never break the
 * request that triggered it.
 */
export async function recordAudit(entry: {
  action: string
  organizationId?: string | null
  actorId?: string | null
  actorEmail?: string | null
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown> | null
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        organizationId: entry.organizationId ?? null,
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: (entry.metadata ?? undefined) as never,
      },
    })
  } catch (error) {
    console.error('Failed to write audit log:', entry.action, error)
  }
}

/** Recent audit entries for an organization. */
export async function listAudit(organizationId: string, limit = 50) {
  return prisma.auditLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  })
}

/**
 * Organizations a user belongs to, in any capacity.
 *
 * Used to scope list endpoints: a request should only ever return rows the
 * caller can actually see, rather than relying on the UI to hide them.
 */
export async function listAccessibleOrganizationIds(userId: string): Promise<string[]> {
  const [owned, memberships] = await Promise.all([
    prisma.organization.findMany({ where: { ownerId: userId }, select: { id: true } }),
    prisma.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true },
    }),
  ])

  return [...new Set([...owned.map((o) => o.id), ...memberships.map((m) => m.organizationId)])]
}
