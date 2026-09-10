import { NextRequest, NextResponse } from 'next/server'
import { recordAudit, requireOrgPermission } from '@/lib/access'
import { createInvitation, listInvitations, resolveOrigin } from '@/lib/invitations'
import { ROLE_DEFINITIONS, normalizeRole } from '@/lib/authz'

interface RouteContext {
  params: Promise<{ orgId: string }>
}

const INVITABLE_ROLES = ['admin', 'developer', 'viewer'] as const

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { orgId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'member:read')
    if (auth.response) return auth.response

    return NextResponse.json({ invitations: await listInvitations(orgId) })
  } catch (error) {
    console.error('List invitations error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Create an invitation for someone who has no account yet.
 *
 * No mail is sent: the response carries the link, which the inviter passes on.
 * Wiring an email provider later only changes who delivers it.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { orgId } = await params
  try {
    const auth = await requireOrgPermission(request, orgId, 'member:invite')
    if (auth.response) return auth.response

    const body = await request.json().catch(() => ({}))
    const email = typeof body?.email === 'string' ? body.email : ''
    const role = typeof body?.role === 'string' ? body.role : 'viewer'
    const customRoleId = typeof body?.customRoleId === 'string' ? body.customRoleId : null

    if (!email.trim()) {
      return NextResponse.json({ error: 'An email address is required.' }, { status: 400 })
    }
    if (!customRoleId && !(INVITABLE_ROLES as readonly string[]).includes(role)) {
      return NextResponse.json(
        { error: `role must be one of: ${INVITABLE_ROLES.join(', ')}` },
        { status: 400 }
      )
    }

    const origin = resolveOrigin({
      authUrl: process.env.AUTH_URL ?? process.env.NEXTAUTH_URL,
      forwardedProto: request.headers.get('x-forwarded-proto'),
      host: request.headers.get('host'),
      fallback: request.nextUrl.origin,
    })

    const invitation = await createInvitation({
      organizationId: orgId,
      email,
      role,
      customRoleId,
      invitedById: auth.session.user.id,
      callerPermissions: auth.permissions,
      origin,
    })

    await recordAudit({
      action: 'member.invite',
      organizationId: orgId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'invitation',
      targetId: invitation.id,
      metadata: {
        email: invitation.email,
        role: invitation.role,
        customRole: invitation.customRole?.name ?? null,
      },
    })

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        roleLabel: ROLE_DEFINITIONS[normalizeRole(invitation.role)].label,
        customRole: invitation.customRole,
        expiresAt: invitation.expiresAt,
      },
      // Shown once — only the hash is stored.
      inviteUrl: invitation.url,
    })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Invalid invitation',
          ...((error as { excess?: string[] }).excess
            ? { detail: `You would be granting: ${(error as { excess?: string[] }).excess?.join(', ')}` }
            : {}),
        },
        { status }
      )
    }
    console.error('Create invitation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
