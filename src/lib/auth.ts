import bcrypt from 'bcryptjs'
import { auth } from '@/auth'

/**
 * Auth helpers.
 *
 * The password hashing is unchanged (bcryptjs, 12 rounds, `$2b$12$`) so every
 * existing credential keeps working.  Session handling is delegated to Auth.js
 * (see src/auth.ts) — `validateSession` is kept as a thin, backwards-compatible
 * wrapper so existing API routes and the Studio gateway need no changes.
 */

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

export interface SessionUser {
  id: string
  email: string
  name?: string | null
  role: string
}

/**
 * Backwards-compatible session check. The `token` argument is ignored — Auth.js
 * reads the session from the request cookies — but the signature is preserved
 * so existing callers keep working.
 */
export async function validateSession(
  _token?: string | null,
): Promise<{ user: SessionUser } | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? '',
      name: session.user.name,
      role: session.user.role ?? 'member',
    },
  }
}

/** Current user or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await validateSession()
  return session?.user ?? null
}

/** Current user, throwing a 401-shaped error object when unauthenticated. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 })
  return user
}
