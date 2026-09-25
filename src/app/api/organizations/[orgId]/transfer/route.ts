import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { recordAudit } from '@/lib/access'
import { getSessionUser } from '@/lib/auth'
import { FORMER_OWNER_ROLE, decideOwnershipTransfer, statusForDecision } from '@/lib/org-lifecycle'

/**
 * Transfer ownership of an organization to another member.
 *
 * Owner-only, and deliberately not gated on a permission: an administrator holds `member:update`
 * and could otherwise hand out ownership, which is exactly what our anti-escalation rule forbids
 * when changing a role. Ownership is a relationship on the organization, not a grantable right.
 *
 * Ownership lives in two places — `Organization.ownerId` and a membership whose role is `owner` — so
 * both move in one transaction. The previous owner keeps administrative access as an `admin`; they
 * are not removed from the organization.
 */
interface RouteContext {
  params: Promise<{ orgId: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await params
    const body = await request.json().catch(() => ({}))
    const memberId = typeof body?.memberId === 'string' ? body.memberId.trim() : ''

    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, ownerId: true },
    })
    if (!organization) {
      return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })
    }

    const target = memberId
      ? await prisma.organizationMember.findFirst({
          where: { id: memberId, organizationId: orgId },
          select: { id: true, userId: true },
        })
      : null

    const decision = decideOwnershipTransfer({
      actorId: user.id,
      ownerId: organization.ownerId,
      targetUserId: target?.userId ?? '',
      isTargetMember: Boolean(target),
    })

    if (!decision.allowed) {
      return NextResponse.json(
        { error: decision.message, code: decision.code },
        { status: statusForDecision(decision.code) }
      )
    }

    // Both representations of ownership move together, or neither does.
    await prisma.$transaction([
      prisma.organization.update({
        where: { id: orgId },
        data: { ownerId: target!.userId },
      }),
      prisma.organizationMember.update({
        where: { id: target!.id },
        data: { role: 'owner', customRoleId: null },
      }),
      prisma.organizationMember.updateMany({
        where: { organizationId: orgId, userId: user.id },
        data: { role: FORMER_OWNER_ROLE },
      }),
    ])

    await recordAudit({
      action: 'org.ownership_transfer',
      organizationId: orgId,
      actorId: user.id,
      actorEmail: user.email,
      targetType: 'user',
      targetId: target!.userId,
      metadata: {
        organization: organization.name,
        from: user.email,
        to: target!.userId,
        formerOwnerRole: FORMER_OWNER_ROLE,
      },
    })

    return NextResponse.json({ success: true, ownerId: target!.userId })
  } catch (error) {
    console.error('Transfer ownership error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
