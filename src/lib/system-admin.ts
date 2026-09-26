/**
 * The system administrator role (#139).
 *
 * Everything else in this codebase is scoped to an organization: you may act on what your
 * membership in *that* organization permits. A system administrator is not a bigger version of that
 * — they are outside it. Holding `owner` in one organization must not be a step towards seeing every
 * other organization's projects, and no amount of organization authority may be exchanged for
 * system authority.
 *
 * So the two are deliberately unrelated:
 *
 *   - organization roles  (viewer/developer/admin/owner) live in `organization_members.role` and
 *     are granted by the organization that owns them;
 *   - the system role     lives in `users.role` and is only ever set deliberately, in the database,
 *     by whoever runs the platform.
 *
 * A caller is a system administrator only when `users.role` says exactly `admin`. Nothing else
 * grants it, no organization role implies it, and the checks below are the single place the
 * comparison happens so it cannot drift.
 *
 * The read is deliberately *not* taken from the session token. A JWT carries the role it was minted
 * with, so a demoted administrator would keep system access until their token expired. The caller
 * re-reads `users.role` from the database on every request — see `getSystemRole` — and treats the
 * token's claim as a display hint at most.
 */

/** The only value of `users.role` that confers system administration. */
export const SYSTEM_ADMIN_ROLE = 'admin'

/** Organization roles, listed so it is obvious they are a different namespace entirely. */
export const ORGANIZATION_ROLES = ['viewer', 'developer', 'admin', 'owner'] as const

export class NotSystemAdminError extends Error {
  readonly status = 403

  constructor(detail: string) {
    super(`Not a system administrator: ${detail}`)
    this.name = 'NotSystemAdminError'
  }
}

/**
 * Is this `users.role` value system administration?
 *
 * Case-insensitive and trimmed, because the value is set by hand in the database and `'Admin'`
 * should not silently mean something different from `'admin'`. Anything else — including an
 * organization role that happens to share a name — is not.
 */
export function isSystemAdmin(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === SYSTEM_ADMIN_ROLE
}

/** Throw unless the role is a system administrator. */
export function assertSystemAdmin(role: string | null | undefined): void {
  if (!isSystemAdmin(role)) {
    throw new NotSystemAdminError(role === null || role === undefined ? 'no role' : `role is "${role}"`)
  }
}
