import { NextRequest, NextResponse } from 'next/server'
import { recordAudit, requireOrgPermission } from '@/lib/access'
import { revokeInvitation } from '@/lib/invitations'

interface RouteContext {
  params: Promise<{ orgId: string; invitationId: string }>
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { orgId, invitationId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'member:invite')
    if (auth.response) return auth.response

    const revoked = await revokeInvitation(orgId, invitationId)
    if (!revoked) {
      return NextResponse.json(
        { error: 'No pending invitation with that id.' },
        { status: 404 }
      )
    }

    await recordAudit({
      action: 'member.invite_revoke',
      organizationId: orgId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'invitation',
      targetId: invitationId,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Revoke invitation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
