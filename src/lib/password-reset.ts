import { createHash, randomBytes } from 'crypto'
import { prisma } from './db'
import { hashPassword } from './auth'

/**
 * Password reset.
 *
 * Design decisions, and the reasoning that matters:
 *
 *  - **Only the token hash is stored.** A leaked database cannot be replayed
 *    into an account takeover.
 *  - **Short-lived** (RESET_TTL_MINUTES) and **single use**.
 *  - **Consuming one token invalidates the rest** for that user, so an older
 *    link cannot be used after a reset has happened.
 *  - **No account enumeration.** `requestReset` answers identically whether or
 *    not the address exists; only the presence of a token differs, internally.
 *  - **No session revocation.** Sessions are JWTs, so a reset does not log an
 *    attacker out of an existing session. Fixing that properly needs a session
 *    version on the user and is tracked separately (#76) rather than pretended
 *    away here.
 */

export const RESET_TTL_MINUTES = 60
export const MIN_PASSWORD_LENGTH = 8

/** The answer given to every request, so a caller cannot tell if it exists. */
export const NEUTRAL_RESET_MESSAGE =
  'If an account exists for that address, a reset link has been issued.'

export interface ResetLike {
  expiresAt: Date
  usedAt?: Date | null
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashResetToken(token) }
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function resetExpiryFrom(now: Date, minutes = RESET_TTL_MINUTES): Date {
  return new Date(now.getTime() + minutes * 60 * 1000)
}

export function isResetUsable(row: ResetLike, now: Date = new Date()): boolean {
  if (row.usedAt) return false
  return row.expiresAt.getTime() > now.getTime()
}

/** Why a reset link cannot be used, phrased for the person seeing it. */
export function describeResetProblem(row: ResetLike | null, now: Date = new Date()): string | null {
  if (!row) return 'This password reset link is not valid.'
  if (row.usedAt) return 'This reset link has already been used. Request a new one.'
  if (row.expiresAt.getTime() <= now.getTime()) {
    return 'This reset link has expired. Request a new one.'
  }
  return null
}

export interface PasswordCheck {
  ok: boolean
  reason?: string
}

/** Password policy, kept in one place so every entry point agrees. */
export function validateNewPassword(password: unknown): PasswordCheck {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, reason: 'A password is required.' }
  }
  if (password.trim().length === 0) {
    return { ok: false, reason: 'A password cannot be only whitespace.' }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    }
  }
  return { ok: true }
}

export function buildResetUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/auth/reset-password/${token}`
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface RequestResetResult {
  /** Null when no account matches — the caller must not distinguish. */
  token: string | null
  expiresAt: Date | null
}

/**
 * Issue a reset token for an address, if that address has an account.
 *
 * Returns nulls rather than throwing for unknown addresses, so the caller can
 * answer neutrally.
 */
export async function requestReset(email: string, now: Date = new Date()): Promise<RequestResetResult> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return { token: null, expiresAt: null }

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true },
  })
  if (!user) return { token: null, expiresAt: null }

  // Clear outstanding tokens so only the newest link works.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: now },
  })

  const { token, tokenHash } = generateResetToken()
  const expiresAt = resetExpiryFrom(now)

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  })

  return { token, expiresAt }
}

export interface ResetTarget {
  id: string
  email: string
  name: string | null
}

/** Look up the account a token belongs to, without consuming it. */
export async function findResetTarget(token: string): Promise<{
  target: ResetTarget | null
  problem: string | null
  expiresAt: Date | null
}> {
  if (!token) return { target: null, problem: 'This password reset link is not valid.', expiresAt: null }

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: { user: { select: { id: true, email: true, name: true } } },
  })

  const problem = describeResetProblem(row)
  if (!row || problem) return { target: null, problem, expiresAt: row?.expiresAt ?? null }

  return { target: row.user, problem: null, expiresAt: row.expiresAt }
}

/**
 * Redeem a token: set the new password and burn the token plus any siblings.
 *
 * Every check lives here rather than in a route, so all callers get the same
 * guarantees.
 */
export async function consumeReset(params: {
  token: string
  newPassword: string
}): Promise<{ userId: string; email: string }> {
  const check = validateNewPassword(params.newPassword)
  if (!check.ok) throw Object.assign(new Error(check.reason), { status: 400 })

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(params.token) },
    include: { user: { select: { id: true, email: true } } },
  })

  const problem = describeResetProblem(row)
  if (problem) {
    throw Object.assign(new Error(problem), { status: row ? 409 : 404 })
  }

  const hashed = await hashPassword(params.newPassword)
  const now = new Date()

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row!.userId },
      // Also stamps when the password last changed, for future auditing.
      data: { password: hashed, updatedAt: now },
    }),
    // Burn this token and every other outstanding one for the account.
    prisma.passwordResetToken.updateMany({
      where: { userId: row!.userId, usedAt: null },
      data: { usedAt: now },
    }),
  ])

  return { userId: row!.userId, email: row!.user.email }
}
