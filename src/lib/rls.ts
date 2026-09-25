/**
 * Running request queries under the restricted database role.
 *
 * The policy layer (`prisma/rls/2026-09-25-control-plane-rls.sql`) enforces that a connection may
 * only read rows belonging to the organization it is acting for. It does nothing on its own: the
 * panel connects as a superuser with BYPASSRLS, so policies never apply to it. This module is the
 * other half — it drops a request's queries onto the restricted role with the acting user declared,
 * and the database then refuses anything that user should not see.
 *
 * The property being bought: a forgotten authorization check in a route handler cannot leak another
 * organization's rows. The failure mode is "no rows", never "someone else's rows", because a
 * connection with no user declared matches no policy at all.
 *
 * Two things here matter more than they look:
 *
 *   1. The user id is passed as a **bound parameter**, never interpolated into SQL text. A session
 *      setting takes a string, so it is exactly the kind of value that becomes an injection vector
 *      if it is concatenated.
 *   2. The value is validated as a UUID first. A malformed id is refused rather than forwarded —
 *      failing to a *wrong* identity is worse than failing to none.
 *
 * Not yet wired into the routes: the authentication tables are deliberately uncovered by policies
 * (sign-in legitimately reads them before an identity exists), so arming this requires deciding how
 * the auth flow reaches them first. See issue #133.
 */

/** The role the request path assumes. NOLOGIN — it is entered from the pool's own connection. */
export const APP_ROLE = 'smbt_app'

export type UserRef = string

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Is this a usable user reference? Only a well-formed UUID is allowed through. */
export function isValidUserRef(value: unknown): value is UserRef {
  return typeof value === 'string' && UUID_RE.test(value)
}

export class InvalidUserRefError extends Error {
  constructor(received: unknown) {
    super(
      `Refusing to scope a request to a malformed user reference (${typeof received}). ` +
        'A session setting must be a UUID; anything else would be forwarded into a session variable.'
    )
    this.name = 'InvalidUserRefError'
  }
}

export interface ScopePlan {
  /** Statements to run before the request's own queries, in order. */
  statements: string[]
  /** The value bound as the session setting, exactly once. */
  parameter: UserRef
}

/**
 * The statements that scope a connection to one user.
 *
 * `set_config(..., true)` is transaction-scoped, so the scoping cannot leak to the next request that
 * borrows the same pooled connection — which is the failure this design most needs to avoid.
 */
export function planRequestScope(userId: unknown): ScopePlan {
  if (!isValidUserRef(userId)) throw new InvalidUserRefError(userId)
  return {
    statements: [
      `set local role ${APP_ROLE}`,
      `select set_config('app.user_id', $1, true)`,
    ],
    parameter: userId,
  }
}

/**
 * Read the declared user back out of the current session, for diagnostics and tests.
 * Returns null when nothing is declared — which is the fail-closed state.
 */
export const READ_CURRENT_SCOPE_SQL = `select nullif(current_setting('app.user_id', true), '')`
