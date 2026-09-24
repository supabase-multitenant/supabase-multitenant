/**
 * Which absolute URLs a signed-in user may be sent back to.
 *
 * Auth.js's default `redirect` callback accepts same-origin URLs only, and falls back to the
 * configured base URL otherwise. That is the right default, but it breaks this platform: each
 * project's Studio is served on its OWN hostname (`<slug>-studio.<platform-domain>`), so a user who
 * signs in from a Studio host is refused the return trip and lands on the panel instead. That is
 * what made a Studio login end on the panel showing "This page could not be found".
 *
 * So the platform needs a wider rule — but widening a redirect rule is an open-redirect risk if it is
 * written as "same domain" or "ends with the base host". The rule here is deliberately narrow:
 *
 *   - the URL must be https
 *   - it must be a **Studio** hostname: `<something>-studio` under the platform's parent domain
 *   - it must be under the SAME parent domain as the panel
 *
 * A lookalike like `evil-213.47.80.26.sslip.io.attacker.com` fails: the parent domain is compared as
 * a suffix of the *hostname*, and the hostname must end with `-studio.<parent>` — `.attacker.com`
 * cannot satisfy that. `-studio` is matched as a full label, so `notastudio.…` is not accepted either.
 */

/** The parent domain shared by the panel and every per-project host, e.g. `.213.47.80.26.sslip.io`. */
export function parentDomainOf(hostname: string): string | null {
  const firstDot = hostname.indexOf('.')
  if (firstDot === -1 || firstDot === hostname.length - 1) return null
  return hostname.slice(firstDot)
}

/**
 * Is `candidate` a per-project Studio hostname for the platform whose panel lives at `baseHost`?
 *
 * The label immediately left of the parent domain must be `<something>-studio`.
 */
export function isStudioHostname(candidate: string, baseHost: string): boolean {
  const parent = parentDomainOf(baseHost)
  if (!parent) return false
  const host = candidate.toLowerCase()
  const suffix = `-studio${parent.toLowerCase()}`
  if (!host.endsWith(suffix)) return false
  // There must be a non-empty project label before `-studio`.
  return host.length > suffix.length
}

/**
 * Resolve the post-sign-in destination.
 *
 * Returns `url` when it is safe to send the user there, otherwise the base URL — mirroring Auth.js's
 * own fallback so behaviour is unchanged for anything this does not explicitly allow.
 */
export function resolveTrustedRedirect(url: string, baseUrl: string): string {
  // Relative URLs resolve against the panel; always fine.
  if (url.startsWith('/')) return `${baseUrl}${url}`

  let target: URL
  let base: URL
  try {
    target = new URL(url)
    base = new URL(baseUrl)
  } catch {
    return baseUrl
  }

  // Same origin as the panel: always allowed.
  if (target.origin === base.origin) return url

  if (target.protocol !== 'https:') return baseUrl

  if (isStudioHostname(target.hostname, base.hostname)) {
    // Keep the path and query (e.g. /project/default) but never the fragment.
    return `${target.origin}${target.pathname}${target.search}`
  }

  return baseUrl
}
