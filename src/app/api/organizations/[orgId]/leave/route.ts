import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { recordAudit } from '@/lib/access'
import { getSessionUser } from '@/lib/auth'
import { decideLeave, statusForDecision } from '@/lib/org-lifecycle'

/**
 * Leave an organization: remove your own membership.
 *
 * Every member may do this — no permission is required to give up your own access. The owner may
 * not: an organization whose owner has left has nobody who can transfer ownership, delete the
 * organization, or grant the role that would fix it, and no UI can repair that state. The refusal
 * names the two ways forward instead of silently doing something destructive.
 *
 * A member who holds a custom role simply loses the membership; the custom role itself belongs to
 * the organization and stays.
 */
interface RouteContext {
  params: Promise<{ orgId: string }>
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await params

    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, ownerId: true },
    })
    if (!organization) {
      return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })
    }

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId: user.id },
      select: { id: true, role: true },
    })

    const decision = decideLeave({
      actorId: user.id,
      ownerId: organization.ownerId,
      isMember: Boolean(membership),
    })

    if (!decision.allowed) {
      return NextResponse.json(
        { error: decision.message, code: decision.code },
        { status: statusForDecision(decision.code) }
      )
    }

    await prisma.organizationMember.delete({ where: { id: membership!.id } })

    await recordAudit({
      action: 'member.leave',
      organizationId: orgId,
      actorId: user.id,
      actorEmail: user.email,
      targetType: 'user',
      targetId: user.id,
      metadata: { organization: organization.name, role: membership!.role },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Leave organization error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
