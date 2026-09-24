/**
 * Minting the API keys a Supabase project hands to its clients.
 *
 * The keys are ordinary HS256 JWTs signed with the project's `JWT_SECRET`. Everything that verifies
 * them — PostgREST, GoTrue, Realtime, Storage, and the Envoy gateway — is configured with that same
 * secret, so a mismatch makes **every** client request fail. It fails loudly but confusingly:

 *     PGRST301: None of the keys was able to decode the JWT
 *     "No suitable key or wrong key type"
 *
 * The previous implementation was a placeholder that never signed anything:
 *
 *     const signature = generateRandomString(43) // Mock signature
 *
 * so every project it created had keys no service could verify. The Data API was unusable for all of
 * them, and the only symptom visible in the dashboard was Studio showing zero tables.
 *
 * Signing is done here rather than inline so it can be tested: a key and its secret must round-trip,
 * and that assertion is what would have caught the placeholder.
 */

import { createHmac } from 'node:crypto'

export type SupabaseRole = 'anon' | 'service_role'

/** Roles a project's public keys carry. */
export const SUPABASE_KEY_ROLES: SupabaseRole[] = ['anon', 'service_role']

/** Long-lived by design: an expiring anon key would silently break a deployed project. */
export const KEY_LIFETIME_SECONDS = 10 * 365 * 24 * 60 * 60

const b64url = (value: object | Buffer): string => {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))
  return buf.toString('base64url')
}

/**
 * Mint an API key for `role`, signed with the project's JWT secret.
 *
 * `iat` is injectable so tests can pin time; production callers pass nothing.
 */
export function mintProjectKey(
  role: SupabaseRole,
  jwtSecret: string,
  options: { now?: number; lifetimeSeconds?: number } = {}
): string {
  if (!jwtSecret) {
    throw new Error('Refusing to mint an API key without a JWT secret')
  }
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const lifetime = options.lifetimeSeconds ?? KEY_LIFETIME_SECONDS

  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const payload = b64url({ role, iss: 'supabase', iat: now, exp: now + lifetime })
  const signingInput = `${header}.${payload}`
  const signature = createHmac('sha256', jwtSecret).update(signingInput).digest('base64url')

  return `${signingInput}.${signature}`
}

/**
 * Verify a key against a secret. Used by tests and by diagnostics — never in a request path, where
 * each service verifies for itself.
 */
export function verifyProjectKey(token: string, jwtSecret: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [header, payload, signature] = parts
  const expected = createHmac('sha256', jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url')
  // Length-safe comparison; both are base64url of the same digest length.
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}

/** The `role` claim of a token, or null when it is not a decodable JWT. */
export function readKeyRole(token: string): string | null {
  try {
    const [, payload] = token.split('.')
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof decoded?.role === 'string' ? decoded.role : null
  } catch {
    return null
  }
}

/**
 * Mint both of a project's keys from one secret.
 *
 * Returns them together so a caller cannot generate a secret and forget to use it — which is exactly
 * the mistake that produced the placeholder.
 */
export function mintProjectKeys(
  jwtSecret: string,
  options: { now?: number } = {}
): { anonKey: string; serviceRoleKey: string } {
  return {
    anonKey: mintProjectKey('anon', jwtSecret, options),
    serviceRoleKey: mintProjectKey('service_role', jwtSecret, options),
  }
}
