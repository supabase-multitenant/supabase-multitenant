import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { recordAudit, requireOrgPermission } from '@/lib/access'
import { checkGrant, validatePermissions } from '@/lib/authz'

interface RouteContext {
  params: Promise<{ orgId: string; roleId: string }>
}

/** Load a custom role, scoped to the organization. */
async function loadRole(orgId: string, roleId: string) {
  const role = await prisma.customRole.findFirst({
    where: { id: roleId, organizationId: orgId },
    include: { _count: { select: { members: true } } },
  })
  return role
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { orgId, roleId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'role:read')
    if (auth.response) return auth.response

    const role = await loadRole(orgId, roleId)
    if (!role) return NextResponse.json({ error: 'Role not found.' }, { status: 404 })

    return NextResponse.json({
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        memberCount: role._count.members,
      },
    })
  } catch (error) {
    console.error('Get role error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { orgId, roleId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'role:manage')
    if (auth.response) return auth.response

    const role = await loadRole(orgId, roleId)
    if (!role) return NextResponse.json({ error: 'Role not found.' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined
    const description = typeof body?.description === 'string' ? body.description.trim() : undefined

    if (name !== undefined && (!name || name.length > 60)) {
      return NextResponse.json(
        { error: 'Role names must be between 1 and 60 characters.' },
        { status: 400 }
      )
    }

    let permissions: string[] | undefined
    if (body?.permissions !== undefined) {
      const { valid, unknown } = validatePermissions(body.permissions)
      if (unknown.length > 0) {
        return NextResponse.json({ error: 'Unknown permissions.', unknown }, { status: 400 })
      }
      if (valid.length === 0) {
        return NextResponse.json(
          { error: 'Select at least one permission for this role.' },
          { status: 400 }
        )
      }

      // Two independent limits: you cannot grant what you do not hold, and you
      // cannot widen a role that already reaches beyond you — otherwise an
      // admin could edit their way past the rules.
      const existing = validatePermissions(role.permissions).valid
      if (!checkGrant(auth.permissions, existing).ok) {
        return NextResponse.json(
          { error: 'This role has access beyond your own, so you cannot edit it.' },
          { status: 403 }
        )
      }
      const grant = checkGrant(auth.permissions, valid)
      if (!grant.ok) {
        return NextResponse.json(
          { error: grant.reason, detail: `Not yours to grant: ${grant.excess?.join(', ')}` },
          { status: 403 }
        )
      }
      permissions = valid
    }

    if (name !== undefined && name !== role.name) {
      const clash = await prisma.customRole.findFirst({
        where: { organizationId: orgId, name, NOT: { id: roleId } },
        select: { id: true },
      })
      if (clash) {
        return NextResponse.json({ error: 'A role with that name already exists.' }, { status: 409 })
      }
    }

    const updated = await prisma.customRole.update({
      where: { id: roleId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
      },
    })

    await recordAudit({
      action: 'role.update',
      organizationId: orgId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'custom_role',
      targetId: roleId,
      metadata: {
        before: { name: role.name, permissions: role.permissions },
        after: { name: updated.name, permissions: updated.permissions },
        affectedMembers: role._count.members,
      },
    })

    return NextResponse.json({ role: updated })
  } catch (error) {
    console.error('Update role error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { orgId, roleId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'role:manage')
    if (auth.response) return auth.response

    const role = await loadRole(orgId, roleId)
    if (!role) return NextResponse.json({ error: 'Role not found.' }, { status: 404 })

    if (!checkGrant(auth.permissions, validatePermissions(role.permissions).valid).ok) {
      return NextResponse.json(
        { error: 'This role has access beyond your own, so you cannot delete it.' },
        { status: 403 }
      )
    }

    // Deleting a role that is in use would silently widen those members (they
    // would fall back to their built-in role), so make the caller reassign first.
    if (role._count.members > 0) {
      return NextResponse.json(
        {
          error: `${role._count.members} member(s) still use this role. Move them to another role first.`,
          memberCount: role._count.members,
        },
        { status: 409 }
      )
    }

    await prisma.customRole.delete({ where: { id: roleId } })

    await recordAudit({
      action: 'role.delete',
      organizationId: orgId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'custom_role',
      targetId: roleId,
      metadata: { name: role.name, permissions: role.permissions },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete role error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
