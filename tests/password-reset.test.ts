import { describe, expect, it, vi } from 'vitest'

// Pure helpers only; stub Prisma so the import stays hermetic.
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/auth', () => ({ hashPassword: async (p: string) => `hashed:${p}` }))

import {
  MIN_PASSWORD_LENGTH,
  NEUTRAL_RESET_MESSAGE,
  RESET_TTL_MINUTES,
  buildResetUrl,
  describeResetProblem,
  generateResetToken,
  hashResetToken,
  isResetUsable,
  resetExpiryFrom,
  validateNewPassword,
} from '@/lib/password-reset'

const NOW = new Date('2026-09-10T12:00:00Z')
const future = (mins = 30) => new Date(NOW.getTime() + mins * 60_000)
const past = (mins = 30) => new Date(NOW.getTime() - mins * 60_000)

describe('reset tokens', () => {
  it('generates a url-safe token and its hash', () => {
    const { token, tokenHash } = generateResetToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(tokenHash).toBe(hashResetToken(token))
  })

  it('is high entropy and unique', () => {
    const seen = new Set(Array.from({ length: 300 }, () => generateResetToken().token))
    expect(seen.size).toBe(300)
    expect(generateResetToken().token.length).toBeGreaterThanOrEqual(42)
  })

  it('does not let the stored hash reveal the token', () => {
    const { token, tokenHash } = generateResetToken()
    expect(tokenHash).not.toBe(token)
    expect(tokenHash.includes(token)).toBe(false)
    expect(hashResetToken(token)).not.toBe(hashResetToken(generateResetToken().token))
  })
})

describe('reset expiry', () => {
  it('defaults to one hour', () => {
    expect(RESET_TTL_MINUTES).toBe(60)
    expect(resetExpiryFrom(NOW).toISOString()).toBe('2026-09-10T13:00:00.000Z')
  })

  it('accepts a custom window', () => {
    expect(resetExpiryFrom(NOW, 15).toISOString()).toBe('2026-09-10T12:15:00.000Z')
  })
})

describe('usability', () => {
  it('accepts an unused, unexpired token', () => {
    const row = { expiresAt: future(), usedAt: null }
    expect(isResetUsable(row, NOW)).toBe(true)
    expect(describeResetProblem(row, NOW)).toBeNull()
  })

  it('refuses a used token', () => {
    const row = { expiresAt: future(), usedAt: NOW }
    expect(isResetUsable(row, NOW)).toBe(false)
    expect(describeResetProblem(row, NOW)).toMatch(/already been used/i)
  })

  it('refuses an expired token, including exactly at the deadline', () => {
    expect(isResetUsable({ expiresAt: past(), usedAt: null }, NOW)).toBe(false)
    expect(describeResetProblem({ expiresAt: past(), usedAt: null }, NOW)).toMatch(/expired/i)
    expect(isResetUsable({ expiresAt: NOW, usedAt: null }, NOW)).toBe(false)
  })

  it('reports a missing token without pretending it expired', () => {
    expect(describeResetProblem(null, NOW)).toMatch(/not valid/i)
  })
})

describe('password policy', () => {
  it('requires a password', () => {
    expect(validateNewPassword(undefined).ok).toBe(false)
    expect(validateNewPassword('').ok).toBe(false)
    expect(validateNewPassword(12345678).ok).toBe(false)
  })

  it('rejects whitespace-only passwords', () => {
    const r = validateNewPassword('          ')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/whitespace/i)
  })

  it('enforces the minimum length at the boundary', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8)
    expect(validateNewPassword('a'.repeat(7)).ok).toBe(false)
    expect(validateNewPassword('a'.repeat(8)).ok).toBe(true)
    expect(validateNewPassword('a'.repeat(7)).reason).toContain('8')
  })

  it('accepts a normal password', () => {
    expect(validateNewPassword('correct horse battery staple').ok).toBe(true)
  })

  it('does not trim the password it accepts', () => {
    // Leading/trailing spaces are legitimate characters, not padding.
    expect(validateNewPassword('  abcdefgh  ').ok).toBe(true)
  })
})

describe('reset url', () => {
  it('joins origin and token', () => {
    expect(buildResetUrl('https://panel.example.com', 'tok')).toBe(
      'https://panel.example.com/auth/reset-password/tok'
    )
  })

  it('tolerates trailing slashes', () => {
    expect(buildResetUrl('https://panel.example.com//', 'tok')).toBe(
      'https://panel.example.com/auth/reset-password/tok'
    )
  })
})

describe('enumeration safety', () => {
  it('has a neutral message that names no account', () => {
    expect(NEUTRAL_RESET_MESSAGE).toMatch(/if an account exists/i)
    expect(NEUTRAL_RESET_MESSAGE.toLowerCase()).not.toContain('not found')
    expect(NEUTRAL_RESET_MESSAGE).not.toMatch(/@/)
  })
})
