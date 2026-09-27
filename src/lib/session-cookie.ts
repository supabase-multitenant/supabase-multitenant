/**
 * The session cookie's name, defined once.
 *
 * The name is not cosmetic. A browser identifies a cookie by name + domain + path, so a cookie
 * written *without* a `Domain` and one written *with* it are two different cookies that happen to
 * share a name — and the browser sends both, oldest first. When the server reads the first one, a
 * fresh sign-in does nothing: the previous person's session answers instead.
 *
 * That is exactly what happened when this cookie was scoped to the platform's parent domain for
 * cross-host SSO: everyone who had signed in before the change kept a host-only `session` cookie,
 * and signing in as somebody else left them authenticated as whoever they had been. Renaming the
 * cookie retires the old one outright — browsers stop sending a name nothing reads — which is a
 * stronger fix than trying to overwrite a cookie the browser considers a different cookie.
 *
 * If this name ever changes again, the previous name belongs in LEGACY_SESSION_COOKIE_NAMES so the
 * stale copies are cleared from browsers rather than left to linger.
 */

/** The one name the panel and every service host read. */
export const SESSION_COOKIE_NAME = 'smbt-session'

/**
 * Cookie names this application used before and no longer reads.
 *
 * Clearing them is hygiene, not security — nothing reads them any more. It stops a browser from
 * sending a dead 4 kB cookie on every request forever, and it makes the change visible in a session
 * list rather than leaving two session-shaped cookies side by side.
 */
export const LEGACY_SESSION_COOKIE_NAMES = ['session', 'next-auth.session-token'] as const

/**
 * Which names among those presented should be expired on the way out.
 *
 * Only names actually present are returned: clearing a cookie that was never sent is a pointless
 * Set-Cookie header on every response.
 */
export function legacyCookiesToClear(present: Iterable<string>): string[] {
  const seen = new Set(present)
  return LEGACY_SESSION_COOKIE_NAMES.filter((name) => seen.has(name))
}
