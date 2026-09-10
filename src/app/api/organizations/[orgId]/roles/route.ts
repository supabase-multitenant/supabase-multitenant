import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { recordAudit, requireOrgPermission } from '@/lib/access'
import { checkGrant, permissionsByGroup, validatePermissions } from '@/lib/authz'

interface RouteContext {
  params: Promise<{ orgId: string }>
}

const MAX_ROLES = 50

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { orgId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'role:read')
    if (auth.response) return auth.response

    const roles = await prisma.customRole.findMany({
      where: { organizationId: orgId },
      include: { _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        memberCount: role._count.members,
        createdAt: role.createdAt,
      })),
      // The catalog, grouped, so the UI can render an accurate picker.
      catalog: permissionsByGroup(),
      // What the caller may hand out — anything beyond this is refused server-side.
      grantablePermissions: auth.permissions,
    })
  } catch (error) {
    console.error('List roles error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { orgId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'role:manage')
    if (auth.response) return auth.response

    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const description = typeof body?.description === 'string' ? body.description.trim() : null

    if (!name) {
      return NextResponse.json({ error: 'A role name is required.' }, { status: 400 })
    }
    if (name.length > 60) {
      return NextResponse.json({ error: 'Role names must be 60 characters or fewer.' }, { status: 400 })
    }

    const { valid, unknown } = validatePermissions(body?.permissions)
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: 'Unknown permissions.', unknown },
        { status: 400 }
      )
    }
    if (valid.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one permission for this role.' },
        { status: 400 }
      )
    }

    // You cannot define a role that reaches beyond your own access.
    const grant = checkGrant(auth.permissions, valid)
    if (!grant.ok) {
      return NextResponse.json(
        { error: grant.reason, detail: `Not yours to grant: ${grant.excess?.join(', ')}` },
        { status: 403 }
      )
    }

    const count = await prisma.customRole.count({ where: { organizationId: orgId } })
    if (count >= MAX_ROLES) {
      return NextResponse.json({ error: `Limit of ${MAX_ROLES} custom roles reached.` }, { status: 409 })
    }

    const clash = await prisma.customRole.findFirst({
      where: { organizationId: orgId, name },
      select: { id: true },
    })
    if (clash) {
      return NextResponse.json({ error: 'A role with that name already exists.' }, { status: 409 })
    }

    const role = await prisma.customRole.create({
      data: { organizationId: orgId, name, description, permissions: valid },
    })

    await recordAudit({
      action: 'role.create',
      organizationId: orgId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'custom_role',
      targetId: role.id,
      metadata: { name, permissions: valid },
    })

    return NextResponse.json({ role })
  } catch (error) {
    console.error('Create role error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
