import { createHash, randomBytes } from 'crypto'
import { prisma } from './db'
import {
  checkGrant,
  permissionsForRole,
  validatePermissions,
  type Permission,
} from './authz'

/**
 * Organization invitations.
 *
 * Design choices worth stating, because they are the difference between a
 * working invite link and a security hole:
 *
 *  - **Only the token hash is stored.** The plaintext token appears once, in the
 *    link we hand back. A leaked database therefore cannot be replayed.
 *  - **Single use.** Accepting flips the status, so a shared link stops working.
 *  - **The email has to match.** Redeeming requires being signed in as the
 *    invited address, so forwarding the link does not hand over access.
 *  - **Expiry.** Links go stale on their own (see INVITE_TTL_DAYS).
 *  - **No escalation.** The inviter must already hold every permission they are
 *    conferring — the same rule that governs direct role changes.
 */

export const INVITE_TTL_DAYS = 7

export type InviteState = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface InviteLike {
  status: string
  expiresAt: Date
  acceptedAt?: Date | null
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Tokens are high-entropy so they cannot be guessed or enumerated. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function expiryFrom(now: Date, days = INVITE_TTL_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}

/** The state a user should be told about, accounting for the clock. */
export function inviteState(invite: InviteLike, now: Date = new Date()): InviteState {
  if (invite.status === 'accepted') return 'accepted'
  if (invite.status === 'revoked') return 'revoked'
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'pending'
}

export function isRedeemable(invite: InviteLike, now: Date = new Date()): boolean {
  return inviteState(invite, now) === 'pending'
}

/** Invite links only work for the address they were sent to. */
export function emailCanRedeem(inviteEmail: string, userEmail: string | null | undefined): boolean {
  if (!userEmail) return false
  return normalizeEmail(inviteEmail) === normalizeEmail(userEmail)
}

/**
 * Why an invitation cannot be redeemed, phrased for the person seeing it.
 * Returns null when it can be redeemed.
 */
export function describeInviteProblem(
  invite: InviteLike & { email: string },
  userEmail: string | null | undefined,
  now: Date = new Date()
): string | null {
  const state = inviteState(invite, now)
  if (state === 'accepted') return 'This invitation has already been used.'
  if (state === 'revoked') return 'This invitation was revoked.'
  if (state === 'expired') return 'This invitation has expired. Ask for a new one.'
  if (!userEmail) return 'Sign in to accept this invitation.'
  if (!emailCanRedeem(invite.email, userEmail)) {
    return `This invitation is for ${invite.email}. You are signed in as ${userEmail}.`
  }
  return null
}

export function buildInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/invite/${token}`
}

/**
 * The public origin to build invite links from.
 *
 * Behind a reverse proxy the request's own host is the internal one, so a
 * configured AUTH_URL wins; otherwise fall back to the forwarded headers.
 */
export function resolveOrigin(input: {
  authUrl?: string | null
  forwardedProto?: string | null
  host?: string | null
  fallback?: string
}): string {
  const configured = input.authUrl?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  const host = input.host?.trim()
  if (host) {
    const proto = input.forwardedProto?.split(',')[0]?.trim() || 'https'
    return `${proto}://${host}`
  }

  return (input.fallback ?? '').replace(/\/+$/, '')
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface CreateInviteInput {
  organizationId: string
  email: string
  role: string
  customRoleId?: string | null
  invitedById: string
  /** Permissions of the person inviting — bounds what may be conferred. */
  callerPermissions: readonly Permission[]
  origin: string
  now?: Date
}

export interface CreateInviteResult {
  id: string
  email: string
  role: string
  customRole: { id: string; name: string } | null
  expiresAt: Date
  /** Shown once. Only the hash is persisted. */
  token: string
  url: string
}

export async function createInvitation(input: CreateInviteInput): Promise<CreateInviteResult> {
  const email = normalizeEmail(input.email)
  if (!email) throw Object.assign(new Error('An email address is required.'), { status: 400 })

  // Resolve what the invite would confer, then refuse to exceed the inviter.
  let granted: Permission[] = permissionsForRole(input.role)
  let customRole: { id: string; name: string } | null = null

  if (input.customRoleId) {
    const found = await prisma.customRole.findFirst({
      where: { id: input.customRoleId, organizationId: input.organizationId },
      select: { id: true, name: true, permissions: true },
    })
    if (!found) {
      throw Object.assign(new Error('Custom role not found in this organization.'), { status: 404 })
    }
    customRole = { id: found.id, name: found.name }
    granted = validatePermissions(found.permissions).valid
  }

  const grant = checkGrant(input.callerPermissions, granted)
  if (!grant.ok) {
    throw Object.assign(new Error(grant.reason ?? 'Forbidden'), {
      status: 403,
      excess: grant.excess,
    })
  }

  const now = input.now ?? new Date()

  // An outstanding invite for the same address is replaced, so the newest link
  // is the only one that works — otherwise a superseded link stays live.
  await prisma.invitation.updateMany({
    where: { organizationId: input.organizationId, email, status: 'pending' },
    data: { status: 'revoked' },
  })

  const { token, tokenHash } = generateInviteToken()
  const expiresAt = expiryFrom(now)

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: input.organizationId,
      email,
      role: input.customRoleId ? 'viewer' : input.role,
      customRoleId: input.customRoleId ?? null,
      tokenHash,
      invitedById: input.invitedById,
      expiresAt,
    },
  })

  return {
    id: invitation.id,
    email,
    role: invitation.role,
    customRole,
    expiresAt,
    token,
    url: buildInviteUrl(input.origin, token),
  }
}

export async function listInvitations(organizationId: string, now: Date = new Date()) {
  const rows = await prisma.invitation.findMany({
    where: { organizationId },
    include: { customRole: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    customRole: row.customRole,
    state: inviteState(row, now),
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  }))
}

export async function revokeInvitation(organizationId: string, invitationId: string): Promise<boolean> {
  const result = await prisma.invitation.updateMany({
    where: { id: invitationId, organizationId, status: 'pending' },
    data: { status: 'revoked' },
  })
  return result.count > 0
}

export async function findByToken(token: string) {
  if (!token) return null
  return prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      customRole: { select: { id: true, name: true } },
    },
  })
}

/** What the accept page needs, without leaking anything the visitor shouldn't see. */
export async function describeInvitationForVisitor(token: string, userEmail: string | null) {
  const invite = await findByToken(token)
  if (!invite) return { found: false as const, problem: 'This invitation link is not valid.' }

  return {
    found: true as const,
    organization: { id: invite.organization.id, name: invite.organization.name },
    role: invite.role,
    customRole: invite.customRole,
    invitedEmail: invite.email,
    expiresAt: invite.expiresAt,
    state: inviteState(invite),
    problem: describeInviteProblem(invite, userEmail),
  }
}

/**
 * Redeem an invitation: create the membership and burn the link.
 *
 * All of the checks happen here rather than in the route, so every caller gets
 * the same guarantees.
 */
export async function acceptInvitation(params: {
  token: string
  userId: string
  userEmail: string | null | undefined
}): Promise<{ organizationId: string; organizationName: string; role: string }> {
  const invite = await findByToken(params.token)
  if (!invite) {
    throw Object.assign(new Error('This invitation link is not valid.'), { status: 404 })
  }

  const problem = describeInviteProblem(invite, params.userEmail)
  if (problem) throw Object.assign(new Error(problem), { status: 409 })

  const already = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: invite.organizationId, userId: params.userId },
    },
    select: { id: true },
  })
  if (already) {
    // Burn the link anyway — it has served its purpose.
    await prisma.invitation.update({ where: { id: invite.id }, data: { status: 'accepted', acceptedAt: new Date() } })
    return {
      organizationId: invite.organizationId,
      organizationName: invite.organization.name,
      role: invite.role,
    }
  }

  await prisma.$transaction([
    prisma.organizationMember.create({
      data: {
        organizationId: invite.organizationId,
        userId: params.userId,
        role: invite.customRoleId ? 'viewer' : invite.role,
        customRoleId: invite.customRoleId,
      },
    }),
    prisma.invitation.update({
      where: { id: invite.id },
      data: { status: 'accepted', acceptedAt: new Date(), acceptedByUserId: params.userId },
    }),
  ])

  return {
    organizationId: invite.organizationId,
    organizationName: invite.organization.name,
    role: invite.role,
  }
}
