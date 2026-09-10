import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { recordAudit, requireOrgPermission } from '@/lib/access'
import {
  ROLE_DEFINITIONS,
  checkGrant,
  normalizeRole,
  permissionsForRole,
  validatePermissions,
  type Permission,
} from '@/lib/authz'

interface RouteContext {
  params: Promise<{ orgId: string; memberId: string }>
}

const ASSIGNABLE_ROLES = ['admin', 'developer', 'viewer'] as const

/** Load the membership and refuse to touch the organization's owner. */
async function loadTarget(orgId: string, memberId: string) {
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: orgId },
    include: { user: { select: { id: true, email: true } }, customRole: { select: { name: true } } },
  })
  if (!member) return { error: 'Member not found.', status: 404 as const }

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { ownerId: true },
  })
  if (organization?.ownerId === member.userId) {
    return {
      error: 'The organization owner cannot be changed here. Transfer ownership instead.',
      status: 409 as const,
    }
  }
  return { member }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { orgId, memberId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'member:update')
    if ('response' in auth) return auth.response

    const target = await loadTarget(orgId, memberId)
    if ('error' in target) {
      return NextResponse.json({ error: target.error }, { status: target.status })
    }

    const body = await request.json().catch(() => ({}))
    const role = typeof body?.role === 'string' ? body.role : null
    const customRoleId =
      body?.customRoleId === null ? null : typeof body?.customRoleId === 'string' ? body.customRoleId : undefined

    if (role && !(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
      return NextResponse.json(
        { error: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` },
        { status: 400 }
      )
    }

    // Work out the permissions this change would confer, then check the caller
    // is not handing out more than they hold themselves.
    let grantedPermissions: Permission[] = role
      ? permissionsForRole(role)
      : permissionsForRole(target.member.role)

    if (customRoleId) {
      const customRole = await prisma.customRole.findFirst({
        where: { id: customRoleId, organizationId: orgId },
        select: { permissions: true },
      })
      if (!customRole) {
        return NextResponse.json({ error: 'Custom role not found in this organization.' }, { status: 404 })
      }
      grantedPermissions = validatePermissions(customRole.permissions).valid
    }

    const grant = checkGrant(auth.permissions, grantedPermissions)
    if (!grant.ok) {
      return NextResponse.json(
        { error: grant.reason, detail: `You would be granting: ${grant.excess?.join(', ')}` },
        { status: 403 }
      )
    }

    const updated = await prisma.organizationMember.update({
      where: { id: target.member.id },
      data: {
        ...(role ? { role } : {}),
        ...(customRoleId !== undefined ? { customRoleId } : {}),
      },
    })

    await recordAudit({
      action: 'member.role_change',
      organizationId: orgId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'user',
      targetId: target.member.userId,
      metadata: {
        email: target.member.user.email,
        from: { role: target.member.role, customRole: target.member.customRole?.name ?? null },
        to: { role, customRoleId },
        effectivePermissions: grantedPermissions,
      },
    })

    return NextResponse.json({
      member: updated,
      roleLabel: ROLE_DEFINITIONS[normalizeRole(updated.role)].label,
      permissions: grantedPermissions,
    })
  } catch (error) {
    console.error('Update member error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { orgId, memberId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'member:remove')
    if ('response' in auth) return auth.response

    const target = await loadTarget(orgId, memberId)
    if ('error' in target) {
      return NextResponse.json({ error: target.error }, { status: target.status })
    }

    if (target.member.userId === auth.session.user.id) {
      return NextResponse.json(
        { error: 'You cannot remove yourself from the organization.' },
        { status: 409 }
      )
    }

    // Do not let the caller remove someone whose access exceeds their own —
    // otherwise a re-invite could be used to sidestep the grant rules.
    const targetPermissions: Permission[] = target.member.customRole
      ? validatePermissions(
          (
            await prisma.customRole.findUnique({
              where: { id: target.member.customRoleId ?? '' },
              select: { permissions: true },
            })
          )?.permissions ?? []
        ).valid
      : permissionsForRole(target.member.role)

    const grant = checkGrant(auth.permissions, targetPermissions)
    if (!grant.ok) {
      return NextResponse.json(
        { error: 'You cannot remove a member with access beyond your own.' },
        { status: 403 }
      )
    }

    await prisma.organizationMember.delete({ where: { id: target.member.id } })

    await recordAudit({
      action: 'member.remove',
      organizationId: orgId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'user',
      targetId: target.member.userId,
      metadata: { email: target.member.user.email, role: target.member.role },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Remove member error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
