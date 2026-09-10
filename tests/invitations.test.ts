import { describe, expect, it, vi } from 'vitest'

// The pure helpers need no database; stub Prisma so the import is hermetic.
vi.mock('@/lib/db', () => ({ prisma: {} }))

import {
  INVITE_TTL_DAYS,
  buildInviteUrl,
  describeInviteProblem,
  emailCanRedeem,
  expiryFrom,
  generateInviteToken,
  hashInviteToken,
  inviteState,
  isRedeemable,
  normalizeEmail,
  resolveOrigin,
} from '@/lib/invitations'

const NOW = new Date('2026-09-10T12:00:00Z')
const future = (days = 1) => new Date(NOW.getTime() + days * 86_400_000)
const past = (days = 1) => new Date(NOW.getTime() - days * 86_400_000)

describe('token generation', () => {
  it('produces a url-safe token and its hash', () => {
    const { token, tokenHash } = generateInviteToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(tokenHash).toBe(hashInviteToken(token))
  })

  it('is high entropy — 32 random bytes', () => {
    // base64url of 32 bytes is 43 chars, and 256 bits cannot be guessed.
    expect(generateInviteToken().token.length).toBeGreaterThanOrEqual(42)
  })

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateInviteToken().token))
    expect(seen.size).toBe(500)
  })

  it('the hash does not reveal the token', () => {
    const { token, tokenHash } = generateInviteToken()
    expect(tokenHash).not.toBe(token)
    expect(tokenHash.includes(token)).toBe(false)
    // and two different tokens never collide
    const other = generateInviteToken()
    expect(other.tokenHash).not.toBe(tokenHash)
  })

  it('hashing is deterministic for the same token', () => {
    expect(hashInviteToken('abc')).toBe(hashInviteToken('abc'))
    expect(hashInviteToken('abc')).not.toBe(hashInviteToken('abd'))
  })
})

describe('expiry', () => {
  it('defaults to a week', () => {
    expect(INVITE_TTL_DAYS).toBe(7)
    expect(expiryFrom(NOW).toISOString()).toBe('2026-09-17T12:00:00.000Z')
  })

  it('accepts a custom window', () => {
    expect(expiryFrom(NOW, 1).toISOString()).toBe('2026-09-11T12:00:00.000Z')
    expect(expiryFrom(NOW, 0).getTime()).toBe(NOW.getTime())
  })
})

describe('invite state', () => {
  const base = { status: 'pending', expiresAt: future(), acceptedAt: null }

  it('is pending before expiry', () => {
    expect(inviteState(base, NOW)).toBe('pending')
    expect(isRedeemable(base, NOW)).toBe(true)
  })

  it('expires exactly at the deadline', () => {
    const atDeadline = { status: 'pending', expiresAt: NOW, acceptedAt: null }
    expect(inviteState(atDeadline, NOW)).toBe('expired')
    expect(isRedeemable(atDeadline, NOW)).toBe(false)
  })

  it('reports expired for a past deadline', () => {
    expect(inviteState({ status: 'pending', expiresAt: past(), acceptedAt: null }, NOW)).toBe('expired')
  })

  it('accepted and revoked win over the clock', () => {
    expect(inviteState({ status: 'accepted', expiresAt: past(), acceptedAt: NOW }, NOW)).toBe('accepted')
    expect(inviteState({ status: 'accepted', expiresAt: future(), acceptedAt: NOW }, NOW)).toBe('accepted')
    expect(inviteState({ status: 'revoked', expiresAt: future(), acceptedAt: null }, NOW)).toBe('revoked')
    expect(isRedeemable({ status: 'accepted', expiresAt: future(), acceptedAt: NOW }, NOW)).toBe(false)
    expect(isRedeemable({ status: 'revoked', expiresAt: future(), acceptedAt: null }, NOW)).toBe(false)
  })
})

describe('email matching', () => {
  it('normalises case and surrounding whitespace', () => {
    expect(normalizeEmail('  Alex@Example.COM ')).toBe('alex@example.com')
    expect(emailCanRedeem('Alex@Example.com', ' alex@example.com ')).toBe(true)
  })

  it('refuses a forwarded link opened by someone else', () => {
    expect(emailCanRedeem('alex@example.com', 'someone@else.com')).toBe(false)
  })

  it('refuses when there is no signed-in email', () => {
    expect(emailCanRedeem('alex@example.com', null)).toBe(false)
    expect(emailCanRedeem('alex@example.com', undefined)).toBe(false)
    expect(emailCanRedeem('alex@example.com', '')).toBe(false)
  })

  it('does not treat different addresses as equal', () => {
    expect(emailCanRedeem('alex@example.com', 'alex@example.com.evil.com')).toBe(false)
    expect(emailCanRedeem('alex@example.com', 'alex+tag@example.com')).toBe(false)
  })
})

describe('describeInviteProblem', () => {
  const invite = { status: 'pending', expiresAt: future(), acceptedAt: null, email: 'invited@example.com' }

  it('passes a valid, matching invite', () => {
    expect(describeInviteProblem(invite, 'invited@example.com', NOW)).toBeNull()
  })

  it('explains a used invite', () => {
    expect(
      describeInviteProblem({ ...invite, status: 'accepted', acceptedAt: NOW }, 'invited@example.com', NOW)
    ).toMatch(/already been used/i)
  })

  it('explains a revoked invite', () => {
    expect(describeInviteProblem({ ...invite, status: 'revoked' }, 'invited@example.com', NOW)).toMatch(/revoked/i)
  })

  it('explains an expired invite', () => {
    expect(describeInviteProblem({ ...invite, expiresAt: past() }, 'invited@example.com', NOW)).toMatch(/expired/i)
  })

  it('asks a signed-out visitor to sign in', () => {
    expect(describeInviteProblem(invite, null, NOW)).toMatch(/sign in/i)
  })

  it('names both addresses when the invite is for someone else', () => {
    const message = describeInviteProblem(invite, 'other@example.com', NOW)
    expect(message).toContain('invited@example.com')
    expect(message).toContain('other@example.com')
  })
})

describe('buildInviteUrl', () => {
  it('joins origin and token', () => {
    expect(buildInviteUrl('https://panel.example.com', 'tok123')).toBe('https://panel.example.com/invite/tok123')
  })

  it('tolerates a trailing slash on the origin', () => {
    expect(buildInviteUrl('https://panel.example.com/', 'tok123')).toBe('https://panel.example.com/invite/tok123')
    expect(buildInviteUrl('https://panel.example.com///', 'tok123')).toBe('https://panel.example.com/invite/tok123')
  })
})

describe('resolveOrigin', () => {
  it('prefers a configured AUTH_URL and strips trailing slashes', () => {
    expect(
      resolveOrigin({ authUrl: 'https://panel.example.com/', host: 'internal:3000', forwardedProto: 'http' })
    ).toBe('https://panel.example.com')
  })

  it('falls back to the forwarded host when nothing is configured', () => {
    expect(resolveOrigin({ host: 'panel.example.com', forwardedProto: 'https' })).toBe(
      'https://panel.example.com'
    )
  })

  it('takes the first value of a comma-separated proto chain', () => {
    expect(resolveOrigin({ host: 'panel.example.com', forwardedProto: 'https, http' })).toBe(
      'https://panel.example.com'
    )
  })

  it('defaults to https rather than silently emitting http', () => {
    expect(resolveOrigin({ host: 'panel.example.com' })).toBe('https://panel.example.com')
  })

  it('ignores blank configuration and whitespace', () => {
    expect(resolveOrigin({ authUrl: '   ', host: '  panel.example.com  ' })).toBe(
      'https://panel.example.com'
    )
  })

  it('uses the fallback origin as a last resort', () => {
    expect(resolveOrigin({ fallback: 'http://localhost:3000/' })).toBe('http://localhost:3000')
  })
})
