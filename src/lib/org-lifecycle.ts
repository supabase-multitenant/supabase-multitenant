/**
 * Organization ownership lifecycle: transferring ownership and leaving.
 *
 * Requirement, in our words (the design is ours; only the behaviour is informed by the reference kit
 * we hold a licence for):
 *
 *   1. Transfer — the current owner hands the organization to another member. Only the current owner
 *      may do it, because ownership is the one thing an administrator must not be able to grant:
 *      our anti-escalation rule already refuses an administrator the `owner` role, and a transfer
 *      path that bypassed that would be the same hole wearing a different hat.
 *   2. Leave — any member may remove themselves. The owner may not: an organization with no owner has
 *      nobody who can delete it, transfer it, or grant ownership, and it cannot be repaired through
 *      the UI. So the owner must transfer first, and the refusal says so.
 *
 * The decisions live here as pure functions so the invariants are testable without a database; the
 * routes do nothing but load rows, apply a decision, and write.
 *
 * Ownership is represented in two places — `Organization.ownerId` and a membership whose role is
 * `owner` — so every change here must move both, in one transaction. Leaving them out of step is the
 * bug this module exists to prevent.
 */

/** The role the previous owner keeps after handing over ownership. */
export const FORMER_OWNER_ROLE = 'admin' as const

export interface Decision {
  allowed: boolean
  /** Stable code for tests and for the API to map to a status. */
  code: 'ok' | 'not_owner' | 'target_not_member' | 'target_is_self' | 'owner_must_transfer' | 'not_member'
  message?: string
}

export interface TransferInput {
  actorId: string
  ownerId: string | null
  targetUserId: string
  isTargetMember: boolean
}

/**
 * May `actorId` transfer this organization to `targetUserId`?
 *
 * Checked in a deliberate order so the most specific reason is the one reported back.
 */
export function decideOwnershipTransfer(input: TransferInput): Decision {
  const { actorId, ownerId, targetUserId, isTargetMember } = input

  if (!ownerId || ownerId !== actorId) {
    return {
      allowed: false,
      code: 'not_owner',
      message: 'Only the organization owner can transfer ownership.',
    }
  }

  if (targetUserId === actorId) {
    return {
      allowed: false,
      code: 'target_is_self',
      message: 'You already own this organization.',
    }
  }

  if (!isTargetMember) {
    return {
      allowed: false,
      code: 'target_not_member',
      message: 'Ownership can only be transferred to an existing member. Invite them first.',
    }
  }

  return { allowed: true, code: 'ok' }
}

export interface LeaveInput {
  actorId: string
  ownerId: string | null
  isMember: boolean
}

/** May `actorId` leave this organization? */
export function decideLeave(input: LeaveInput): Decision {
  const { actorId, ownerId, isMember } = input

  if (!isMember) {
    // A non-member must learn nothing about the organization's existence.
    return { allowed: false, code: 'not_member', message: 'Organization not found.' }
  }

  if (ownerId && ownerId === actorId) {
    return {
      allowed: false,
      code: 'owner_must_transfer',
      message:
        'You own this organization. Transfer ownership to another member before leaving, or delete the organization.',
    }
  }

  return { allowed: true, code: 'ok' }
}

/** HTTP status for a refusal, so routes do not each invent their own. */
export function statusForDecision(code: Decision['code']): number {
  switch (code) {
    case 'not_member':
    case 'target_not_member':
      return 404
    case 'not_owner':
      return 403
    case 'target_is_self':
    case 'owner_must_transfer':
      return 400
    default:
      return 200
  }
}
