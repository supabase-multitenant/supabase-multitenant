import { describe, expect, it } from 'vitest'

import { resolveCookieDomain } from '@/lib/cookie-domain'

const PLATFORM = 'https://fmhych0pt0irtksig4kciewg.213.47.80.26.sslip.io'

describe('the live deployment', () => {
  it('scopes the cookie to the parent so every Studio host shares the session', () => {
    // This is what makes "Open Studio" stop asking a signed-in user to sign in again: the panel and
    // `<slug>-studio.<same parent>` are siblings, and only a parent-scoped cookie reaches both.
    expect(resolveCookieDomain({ authUrl: PLATFORM })).toBe('.213.47.80.26.sslip.io')
  })

  it('covers a Studio-style sibling host', () => {
    const domain = resolveCookieDomain({ authUrl: PLATFORM })
    const studio = 'project101-of-org202-1790168723120-studio.213.47.80.26.sslip.io'
    expect(studio.endsWith(domain!.slice(1))).toBe(true)
  })
})

describe('when it must refuse and fall back to host-only', () => {
  it('refuses a bare domain whose parent is a public suffix', () => {
    // Domain=.com would be rejected by the browser at best and catastrophic at worst.
    expect(resolveCookieDomain({ authUrl: 'https://example.com' })).toBeNull()
  })

  it('refuses when the PARENT is a compound public suffix', () => {
    // The rule applies to the parent, not the host. `app.example.co.uk` has the perfectly good
    // parent `example.co.uk`; it is `www.co.uk` whose parent (`co.uk`) must be refused.
    for (const host of ['www.co.uk', 'foo.com.au', 'bar.co.jp', 'x.org.uk']) {
      expect(resolveCookieDomain({ host })).toBeNull()
    }
  })

  it('still scopes a normal host under a compound suffix', () => {
    // The legit case the rule above must not swallow: this is a real deployment shape, and its
    // parent is exactly the domain every sibling host shares.
    expect(resolveCookieDomain({ host: 'app.example.co.uk' })).toBe('.example.co.uk')
    expect(resolveCookieDomain({ host: 'panel.example.com.au' })).toBe('.example.com.au')
  })

  it('refuses localhost, with or without a port', () => {
    expect(resolveCookieDomain({ authUrl: 'http://localhost:3000' })).toBeNull()
    expect(resolveCookieDomain({ host: 'app.localhost' })).toBeNull()
  })

  it('refuses a raw IP, which has no scopeable parent', () => {
    expect(resolveCookieDomain({ authUrl: 'http://213.47.80.26:3000' })).toBeNull()
    expect(resolveCookieDomain({ host: '10.0.2.1' })).toBeNull()
  })

  it('refuses nothing at all', () => {
    expect(resolveCookieDomain({})).toBeNull()
    expect(resolveCookieDomain({ authUrl: '' })).toBeNull()
    expect(resolveCookieDomain({ already: undefined } as never)).toBeNull()
  })

  it('still scopes a deeper subdomain', () => {
    expect(resolveCookieDomain({ host: 'app.staging.example.com' })).toBe('.staging.example.com')
  })
})

describe('the explicit override', () => {
  it('wins over derivation', () => {
    expect(resolveCookieDomain({ authUrl: PLATFORM, explicit: 'example.org' })).toBe('.example.org')
  })

  it('normalizes a leading dot so both spellings behave the same', () => {
    expect(resolveCookieDomain({ explicit: '.example.org' })).toBe('.example.org')
    expect(resolveCookieDomain({ explicit: ' example.org ' })).toBe('.example.org')
  })

  it('lets an empty string force host-only', () => {
    // The escape hatch when derivation would be wrong for a particular deployment.
    expect(resolveCookieDomain({ authUrl: PLATFORM, explicit: '' })).toBeNull()
  })

  it('does not treat an unset override as the empty-string override', () => {
    // '' means "force host-only"; undefined means "decide for me". Conflating them would silently
    // disable single-sign-on everywhere.
    expect(resolveCookieDomain({ authUrl: PLATFORM, explicit: undefined })).toBe('.213.47.80.26.sslip.io')
  })

  it('drops a port from an explicit value', () => {
    // A cookie Domain is a host. Leaving the port in would be rejected by the browser and would
    // quietly turn single-sign-on off instead of failing visibly.
    expect(resolveCookieDomain({ explicit: 'example.org:8443' })).toBe('.example.org')
  })
})
