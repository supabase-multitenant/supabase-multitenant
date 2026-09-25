import { describe, expect, it } from 'vitest'

import {
  FORMER_OWNER_ROLE,
  decideLeave,
  decideOwnershipTransfer,
  statusForDecision,
} from '@/lib/org-lifecycle'

const OWNER = 'user-owner'
const ADMIN = 'user-admin'
const MEMBER = 'user-member'

describe('transferring ownership', () => {
  it('allows the owner to transfer to an existing member', () => {
    const d = decideOwnershipTransfer({
      actorId: OWNER, ownerId: OWNER, targetUserId: MEMBER, isTargetMember: true,
    })
    expect(d.allowed).toBe(true)
  })

  it('refuses an administrator — ownership is not a grantable permission', () => {
    // The whole reason transfer is not gated on a permission: an admin holds member:update, so a
    // permission-gated transfer would let them hand out ownership, which our anti-escalation rule
    // forbids when changing a role.
    const d = decideOwnershipTransfer({
      actorId: ADMIN, ownerId: OWNER, targetUserId: MEMBER, isTargetMember: true,
    })
    expect(d.allowed).toBe(false)
    expect(d.code).toBe('not_owner')
    expect(statusForDecision(d.code)).toBe(403)
  })

  it('refuses a transfer to yourself', () => {
    const d = decideOwnershipTransfer({
      actorId: OWNER, ownerId: OWNER, targetUserId: OWNER, isTargetMember: true,
    })
    expect(d.allowed).toBe(false)
    expect(d.code).toBe('target_is_self')
    expect(statusForDecision(d.code)).toBe(400)
  })

  it('refuses a target who is not a member', () => {
    const d = decideOwnershipTransfer({
      actorId: OWNER, ownerId: OWNER, targetUserId: 'stranger', isTargetMember: false,
    })
    expect(d.allowed).toBe(false)
    expect(d.code).toBe('target_not_member')
    expect(statusForDecision(d.code)).toBe(404)
  })

  it('refuses when the organization has no owner at all', () => {
    const d = decideOwnershipTransfer({
      actorId: OWNER, ownerId: null, targetUserId: MEMBER, isTargetMember: true,
    })
    expect(d.allowed).toBe(false)
    expect(d.code).toBe('not_owner')
  })

  it('refuses before it can mislead: a non-owner targeting a non-member is told they are not owner', () => {
    const d = decideOwnershipTransfer({
      actorId: ADMIN, ownerId: OWNER, targetUserId: 'stranger', isTargetMember: false,
    })
    expect(d.code).toBe('not_owner')
  })

  it('the previous owner keeps administrative access rather than losing it', () => {
    // Leaving them with no role would lock them out of an organization they still work in.
    expect(FORMER_OWNER_ROLE).toBe('admin')
  })
})

describe('leaving an organization', () => {
  it('allows an ordinary member to leave', () => {
    const d = decideLeave({ actorId: MEMBER, ownerId: OWNER, isMember: true })
    expect(d.allowed).toBe(true)
  })

  it('refuses the owner, and says what to do instead', () => {
    const d = decideLeave({ actorId: OWNER, ownerId: OWNER, isMember: true })
    expect(d.allowed).toBe(false)
    expect(d.code).toBe('owner_must_transfer')
    expect(d.message).toMatch(/transfer/i)
    expect(statusForDecision(d.code)).toBe(400)
  })

  it('tells a non-member nothing — not even that the organization exists', () => {
    const d = decideLeave({ actorId: 'stranger', ownerId: OWNER, isMember: false })
    expect(d.allowed).toBe(false)
    expect(d.code).toBe('not_member')
    expect(d.message).toBe('Organization not found.')
    expect(statusForDecision(d.code)).toBe(404)
  })

  it('a member is refused by ownership, not by membership, when they own the org', () => {
    const d = decideLeave({ actorId: OWNER, ownerId: OWNER, isMember: true })
    expect(d.code).not.toBe('not_member')
  })
})

describe('the two rules fit together', () => {
  it('an owner cannot leave, but can transfer and then leave', () => {
    // The point of the pair: transfer is the only way out for an owner, and it is reachable.
    const transfer = decideOwnershipTransfer({
      actorId: OWNER, ownerId: OWNER, targetUserId: MEMBER, isTargetMember: true,
    })
    expect(transfer.allowed).toBe(true)

    // After transferring, the former owner is an ordinary member and may leave.
    const leave = decideLeave({ actorId: OWNER, ownerId: MEMBER, isMember: true })
    expect(leave.allowed).toBe(true)
  })
})
