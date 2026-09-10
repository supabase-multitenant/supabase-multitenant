import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { recordAudit, requireOrgPermission } from '@/lib/access'
import {
  ALL_PERMISSIONS,
  ROLE_DEFINITIONS,
  checkGrant,
  normalizeRole,
  permissionsForRole,
  validatePermissions,
} from '@/lib/authz'

interface RouteContext {
  params: Promise<{ orgId: string }>
}

/**
 * Roles an administrator may hand out here.
 *
 * `owner` is deliberately absent: ownership lives on the organization itself
 * (Organization.ownerId) and transferring it is a separate, explicit operation —
 * having two sources of truth for "who owns this" is how access bugs start.
 */
const ASSIGNABLE_ROLES = ['admin', 'developer', 'viewer'] as const

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { orgId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'member:read')
    if ('response' in auth) return auth.response

    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { ownerId: true },
    })

    const members = await prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: {
        user: { select: { id: true, email: true, name: true, createdAt: true } },
        customRole: { select: { id: true, name: true, permissions: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const owner = await prisma.user.findUnique({
      where: { id: organization?.ownerId ?? '' },
      select: { id: true, email: true, name: true, createdAt: true },
    })

    return NextResponse.json({
      // The owner is rendered from the organization, not from the member table.
      owner: owner
        ? {
            ...owner,
            role: 'owner',
            customRole: null,
            isOwner: true,
            permissions: [...ALL_PERMISSIONS],
          }
        : null,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        roleLabel: ROLE_DEFINITIONS[normalizeRole(m.role)].label,
        customRole: m.customRole
          ? { id: m.customRole.id, name: m.customRole.name, permissions: m.customRole.permissions }
          : null,
        joinedAt: m.createdAt,
        isOwner: false,
        // What this member can actually do, once custom roles are applied.
        permissions: m.customRole?.permissions?.length
          ? m.customRole.permissions
          : permissionsForRole(m.role),
      })),
      assignableRoles: ASSIGNABLE_ROLES.map((role) => ({
        value: role,
        label: ROLE_DEFINITIONS[role].label,
        description: ROLE_DEFINITIONS[role].description,
      })),
      // The caller's own permissions, so the UI can hide what they cannot do.
      viewerPermissions: auth.permissions,
    })
  } catch (error) {
    console.error('List members error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Add an existing account to the organization by email.
 *
 * Accounts are looked up, not created: invitations for people who have not
 * signed up yet (token links) are a separate piece of work.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { orgId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'member:invite')
    if ('response' in auth) return auth.response

    const body = await request.json().catch(() => ({}))
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const role = typeof body?.role === 'string' ? body.role : 'viewer'
    const customRoleId = typeof body?.customRoleId === 'string' ? body.customRoleId : null

    if (!email) {
      return NextResponse.json({ error: 'An email address is required.' }, { status: 400 })
    }
    if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role) && !customRoleId) {
      return NextResponse.json(
        { error: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` },
        { status: 400 }
      )
    }

    // Resolve what the new member would be able to do, and refuse to hand out
    // more access than the caller holds.
    let grantedPermissions = permissionsForRole(role)
    if (customRoleId) {
      const customRole = await prisma.customRole.findFirst({
        where: { id: customRoleId, organizationId: orgId },
        select: { id: true, name: true, permissions: true },
      })
      if (!customRole) {
        return NextResponse.json({ error: 'Custom role not found in this organization.' }, { status: 404 })
      }
      grantedPermissions = validatePermissions(customRole.permissions).valid
    }

    const grant = checkGrant(auth.permissions, grantedPermissions)
    if (!grant.ok) {
      return NextResponse.json(
        {
          error: grant.reason,
          detail: `You would be granting: ${grant.excess?.join(', ')}`,
        },
        { status: 403 }
      )
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })
    if (!user) {
      return NextResponse.json(
        {
          error: 'No account with that email yet.',
          hint: 'Ask them to register first, then add them here. Invitation links for new people are not built yet.',
        },
        { status: 409 }
      )
    }

    const existing = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: 'That person is already a member.' }, { status: 409 })
    }

    if (await prisma.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } })
        .then((o) => o?.ownerId === user.id)) {
      return NextResponse.json({ error: 'That person already owns this organization.' }, { status: 409 })
    }

    const member = await prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        role: customRoleId ? 'viewer' : role,
        customRoleId,
      },
    })

    await recordAudit({
      action: 'member.add',
      organizationId: orgId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'user',
      targetId: user.id,
      metadata: { email: user.email, role, customRoleId },
    })

    return NextResponse.json({ member })
  } catch (error) {
    console.error('Add member error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
