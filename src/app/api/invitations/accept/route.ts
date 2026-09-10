import { NextRequest, NextResponse } from 'next/server'
import { getSession, unauthorized } from '@/lib/api-auth'
import { recordAudit } from '@/lib/access'
import { acceptInvitation } from '@/lib/invitations'

/**
 * Redeem an invitation for the signed-in user.
 *
 * The session is required: the invitation is bound to an email address, and we
 * need to know who is claiming it to enforce that.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) return unauthorized()

    const body = await request.json().catch(() => ({}))
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!token) {
      return NextResponse.json({ error: 'A token is required.' }, { status: 400 })
    }

    const result = await acceptInvitation({
      token,
      userId: session.user.id,
      userEmail: session.user.email,
    })

    await recordAudit({
      action: 'member.invite_accept',
      organizationId: result.organizationId,
      actorId: session.user.id,
      actorEmail: session.user.email,
      targetType: 'organization',
      targetId: result.organizationId,
      metadata: { role: result.role },
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not accept the invitation' },
        { status }
      )
    }
    console.error('Accept invitation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
