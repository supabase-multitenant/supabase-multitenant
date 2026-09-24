import { describe, expect, it } from 'vitest'

import {
  KEY_LIFETIME_SECONDS,
  mintProjectKey,
  mintProjectKeys,
  readKeyRole,
  verifyProjectKey,
} from '@/lib/supabase-jwt'

const SECRET = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

describe('a minted key is verifiable with the secret that signed it', () => {
  it('round-trips for both roles', () => {
    // This is the assertion whose absence let a placeholder signature ship. Every service verifies
    // keys against the project's JWT secret, so a key that does not verify makes the whole Data API
    // unusable.
    for (const role of ['anon', 'service_role'] as const) {
      const key = mintProjectKey(role, SECRET)
      expect(verifyProjectKey(key, SECRET)).toBe(true)
      expect(readKeyRole(key)).toBe(role)
    }
  })

  it('does NOT verify under a different secret', () => {
    const key = mintProjectKey('anon', SECRET)
    expect(verifyProjectKey(key, OTHER)).toBe(false)
  })

  it('is a three-part HS256 JWT', () => {
    const key = mintProjectKey('anon', SECRET)
    const parts = key.split('.')
    expect(parts).toHaveLength(3)
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
  })

  it('signs with base64url, so the key is URL-safe', () => {
    const key = mintProjectKey('anon', SECRET)
    expect(key).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })
})

describe('claims', () => {
  it('carries iss=supabase, iat and exp', () => {
    const now = 1_700_000_000
    const key = mintProjectKey('anon', SECRET, { now })
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
    expect(payload.iss).toBe('supabase')
    expect(payload.iat).toBe(now)
    expect(payload.exp).toBe(now + KEY_LIFETIME_SECONDS)
  })

  it('does not expire in the short term, which would silently break a project', () => {
    const payload = JSON.parse(
      Buffer.from(mintProjectKey('anon', SECRET).split('.')[1], 'base64url').toString()
    )
    const years = (payload.exp - payload.iat) / (365 * 24 * 3600)
    expect(years).toBeGreaterThanOrEqual(5)
  })
})

describe('refusals and robustness', () => {
  it('refuses to mint without a secret', () => {
    expect(() => mintProjectKey('anon', '')).toThrow()
  })

  it('rejects malformed tokens instead of throwing', () => {
    expect(verifyProjectKey('not-a-jwt', SECRET)).toBe(false)
    expect(verifyProjectKey('a.b', SECRET)).toBe(false)
    expect(verifyProjectKey('', SECRET)).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const key = mintProjectKey('anon', SECRET)
    const [h, , s] = key.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase' }))
      .toString('base64url')
    expect(verifyProjectKey(`${h}.${forgedPayload}.${s}`, SECRET)).toBe(false)
  })

  it('readKeyRole returns null for junk', () => {
    expect(readKeyRole('nope')).toBeNull()
    expect(readKeyRole('a.b.c')).toBeNull()
  })
})

describe('mintProjectKeys', () => {
  it('returns both keys, both verifiable with the same secret', () => {
    // Returning them together is deliberate: a caller cannot generate a secret and forget to sign.
    const { anonKey, serviceRoleKey } = mintProjectKeys(SECRET)
    expect(verifyProjectKey(anonKey, SECRET)).toBe(true)
    expect(verifyProjectKey(serviceRoleKey, SECRET)).toBe(true)
    expect(readKeyRole(anonKey)).toBe('anon')
    expect(readKeyRole(serviceRoleKey)).toBe('service_role')
    expect(anonKey).not.toBe(serviceRoleKey)
  })
})
