import { describe, expect, it } from 'vitest'

import {
  LEGACY_SESSION_COOKIE_NAMES,
  SESSION_COOKIE_NAME,
  legacyCookiesToClear,
} from '@/lib/session-cookie'

describe('the session cookie name', () => {
  it('is never a name this application used before', () => {
    // The bug this prevents, in full: browsers identify a cookie by name *and* domain, so a
    // host-only `session` and a domain-scoped `session` are two cookies that are both sent, oldest
    // first. Signing in as somebody else then left the previous person signed in, because the server
    // read the stale one. Reusing a retired name would reintroduce it.
    expect(LEGACY_SESSION_COOKIE_NAMES as readonly string[]).not.toContain(SESSION_COOKIE_NAME)
    expect(LEGACY_SESSION_COOKIE_NAMES as readonly string[]).toContain('session')
  })

  it('is a concrete, non-empty name', () => {
    expect(typeof SESSION_COOKIE_NAME).toBe('string')
    expect(SESSION_COOKIE_NAME.length).toBeGreaterThan(0)
  })
})

describe('clearing retired cookies', () => {
  it('clears only the retired names that were actually presented', () => {
    expect(legacyCookiesToClear(['session'])).toEqual(['session'])
    expect(legacyCookiesToClear(['session', 'next-auth.session-token'])).toEqual([
      'session',
      'next-auth.session-token',
    ])
  })

  it('leaves the current session cookie alone', () => {
    // The single most dangerous version of this change: expiring the cookie we actually read.
    expect(legacyCookiesToClear([SESSION_COOKIE_NAME])).toEqual([])
    expect(legacyCookiesToClear([SESSION_COOKIE_NAME, 'session'])).toEqual(['session'])
  })

  it('clears nothing when nothing retired was sent', () => {
    expect(legacyCookiesToClear([])).toEqual([])
    expect(legacyCookiesToClear(['theme', 'sidebar-open'])).toEqual([])
  })

  it('does not treat a lookalike name as a retired one', () => {
    for (const name of ['sessions', 'session2', 'my-session', 'Session']) {
      expect(legacyCookiesToClear([name])).toEqual([])
    }
  })

  it('accepts any iterable of names', () => {
    expect(legacyCookiesToClear(new Set(['session']))).toEqual(['session'])
  })
})
