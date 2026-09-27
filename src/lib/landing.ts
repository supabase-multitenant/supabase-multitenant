/**
 * Where a signed-in account should land.
 *
 * Two audiences share one sign-in form: ordinary members, who belong inside an organization, and
 * platform administrators, who administer the platform itself. Dropping the second group on the
 * ordinary organization list makes them navigate to the system view by hand every time, so the
 * destination is chosen from the role.
 *
 * This only decides a *landing*: a system administrator who asks for the ordinary pages still gets
 * them, because an explicit request always wins over the default.
 */

/** Where a member lands: the organizations they belong to. */
export const DEFAULT_LANDING = '/organizations'

/** Where a platform administrator lands: the system view. */
export const SYSTEM_LANDING = '/admin'

export function landingFor(systemAdmin: boolean): string {
  return systemAdmin ? SYSTEM_LANDING : DEFAULT_LANDING
}

/**
 * The path the caller explicitly asked for, or null when there is not a safe one.
 *
 * A redirect target that arrives in a query string is attacker-controllable, so anything that could
 * leave this site is refused rather than followed:
 *   - `//evil.example` is protocol-relative: a browser reads it as a host, not a path.
 *   - `/\evil.example` is the same thing to several browsers, which normalise the backslash.
 * The result is a path on this origin, or nothing.
 */
export function requestedPath(next: string | null | undefined): string | null {
  if (typeof next !== 'string') return null
  if (!next.startsWith('/')) return null
  if (next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}

/**
 * The landing destination for this sign-in.
 *
 * An explicit, safe request wins — someone who followed a link to a particular page must arrive
 * there. Otherwise the role decides.
 */
export function resolveLanding(next: string | null | undefined, systemAdmin: boolean): string {
  return requestedPath(next) ?? landingFor(systemAdmin)
}
