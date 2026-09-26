/**
 * Which domain the session cookie belongs to (#27).
 *
 * The panel and every project's Studio are served from sibling hostnames under one parent —
 * `panel.<platform>` and `<slug>-studio.<platform>`. By default a cookie has no `Domain` attribute,
 * which makes it *host-only*: the browser sends it back to the panel and to nothing else. So a
 * signed-in user clicking "Open Studio" arrives at the Studio host with no session and is asked to
 * log in again, on a host they are already authenticated for. That is the whole of #27.
 *
 * Setting `Domain=<parent>` makes the one session valid across the platform's own hosts — the
 * single-sign-on behaviour the product needs — while still not being sent anywhere else.
 *
 * Two rules keep this from becoming a security problem:
 *
 *   1. The domain is only ever the host's parent, never a fixed string. Deriving it means a
 *      deployment on any domain gets the right cookie without hand-configuration.
 *   2. It is refused in every case where "the parent" is not a name we may write cookies for: a bare
 *      domain (its parent is a public suffix such as `.com`), a raw IP, localhost, and the common
 *      two-label public suffixes. Refusing falls back to host-only, which is the safe direction —
 *      the cost is asking the user to sign in again, not a mis-scoped cookie.
 *
 * `AUTH_COOKIE_DOMAIN` overrides everything, because no local heuristic replaces a real public
 * suffix list. Set it to the explicit domain, or to an empty string to force host-only.
 */

/** Two-label public suffixes that would otherwise look like a safe parent. Not exhaustive — hence
 * the override — but it covers the cases where a wrong answer is realistic. */
const COMPOUND_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'ne.jp', 'or.jp', 'go.jp', 'ac.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'co.za', 'org.za', 'net.za', 'gov.za',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.mx', 'com.tr', 'com.tw', 'com.hk', 'com.sg', 'com.my',
  'co.in', 'net.in', 'org.in', 'gov.in',
  'co.kr', 'or.kr', 'co.il', 'com.ar', 'com.pl', 'com.ua',
])

export interface CookieDomainInput {
  /** The panel's own origin, e.g. from AUTH_URL. Used to derive the parent when nothing is forced. */
  authUrl?: string | null
  /** A hostname to use instead of parsing authUrl. */
  host?: string | null
  /** `AUTH_COOKIE_DOMAIN`: an explicit domain, or '' to force host-only. */
  explicit?: string | null
}

function hostFrom(input: CookieDomainInput): string | null {
  if (input.host) return input.host
  if (!input.authUrl) return null
  try {
    return new URL(input.authUrl).hostname
  } catch {
    // A bare host such as "example.com" is not a URL; accept it as one.
    return input.authUrl.replace(/^[a-z]+:\/\//i, '').split('/')[0] || null
  }
}

/**
 * The `Domain` attribute for the session cookie, or null for host-only.
 *
 * Null is a normal, correct answer: it is what a single-host deployment should get, and what any
 * unscopable host falls back to.
 */
export function resolveCookieDomain(input: CookieDomainInput = {}): string | null {
  // An explicit value wins, including an explicit empty string meaning "keep it host-only".
  if (input.explicit !== undefined && input.explicit !== null) {
    // Strip a port before anything else: a cookie Domain is a host, and `example.org:8443` would be
    // silently rejected by the browser, quietly turning single-sign-on off.
    const forced = input.explicit
      .trim()
      .replace(/^\./, '')
      .replace(/:\d+$/, '')
    return forced === '' ? null : `.${forced.toLowerCase()}`
  }

  const raw = hostFrom(input)
  if (!raw) return null

  const host = raw.trim().toLowerCase().replace(/\.$/, '')
  if (!host) return null
  if (host === 'localhost' || host.endsWith('.localhost')) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null // a raw IP has no scopeable parent
  if (host.includes(':') && !host.includes('.')) return null // bare IPv6

  const labels = host.split('.').filter(Boolean)
  // "example.com" has no parent we may write to — its parent is a public suffix.
  if (labels.length < 3) return null

  const parent = labels.slice(1).join('.')
  if (!parent.includes('.')) return null
  if (COMPOUND_SUFFIXES.has(parent)) return null

  return `.${parent}`
}
