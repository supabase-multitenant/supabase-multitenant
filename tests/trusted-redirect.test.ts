import { describe, expect, it } from 'vitest'

import { isStudioHostname, parentDomainOf, resolveTrustedRedirect } from '@/lib/trusted-redirect'

const BASE = 'https://fmhych0pt0irtksig4kciewg.213.47.80.26.sslip.io'
const STUDIO = 'https://project101-of-org202-1790168723120-studio.213.47.80.26.sslip.io'

describe('parentDomainOf', () => {
  it('drops the leftmost label', () => {
    expect(parentDomainOf('fmhych0pt0irtksig4kciewg.213.47.80.26.sslip.io')).toBe(
      '.213.47.80.26.sslip.io'
    )
  })

  it('returns null when there is no parent', () => {
    expect(parentDomainOf('localhost')).toBeNull()
    expect(parentDomainOf('')).toBeNull()
  })
})

describe('isStudioHostname', () => {
  it('accepts a per-project studio host', () => {
    expect(isStudioHostname('project101-of-org202-1790168723120-studio.213.47.80.26.sslip.io',
      'fmhych0pt0irtksig4kciewg.213.47.80.26.sslip.io')).toBe(true)
  })

  it('rejects a host that is not under the platform parent domain', () => {
    expect(isStudioHostname('evil-studio.attacker.com', 'panel.example.com')).toBe(false)
  })

  it('rejects a parent-domain lookalike', () => {
    // The suffix check is on the end of the hostname, so appending a different domain fails.
    expect(
      isStudioHostname('x-studio.213.47.80.26.sslip.io.attacker.com', 'panel.213.47.80.26.sslip.io')
    ).toBe(false)
  })

  it('requires -studio to be its own label', () => {
    expect(isStudioHostname('notastudio.213.47.80.26.sslip.io', 'panel.213.47.80.26.sslip.io')).toBe(
      false
    )
  })

  it('requires a project label before -studio', () => {
    expect(isStudioHostname('-studio.213.47.80.26.sslip.io', 'panel.213.47.80.26.sslip.io')).toBe(
      false
    )
  })
})

describe('resolveTrustedRedirect', () => {
  it('keeps relative URLs on the panel', () => {
    expect(resolveTrustedRedirect('/dashboard', BASE)).toBe(`${BASE}/dashboard`)
  })

  it('allows a same-origin URL', () => {
    expect(resolveTrustedRedirect(`${BASE}/dashboard`, BASE)).toBe(`${BASE}/dashboard`)
  })

  it('allows the Studio host, preserving path and query', () => {
    // This is the fix: signing in on a Studio host must return there, not to the panel.
    expect(resolveTrustedRedirect(`${STUDIO}/project/default?tab=sql`, BASE)).toBe(
      `${STUDIO}/project/default?tab=sql`
    )
  })

  it('drops the fragment', () => {
    expect(resolveTrustedRedirect(`${STUDIO}/project/default#anchor`, BASE)).toBe(
      `${STUDIO}/project/default`
    )
  })

  it('falls back to the panel for a foreign origin', () => {
    expect(resolveTrustedRedirect('https://evil.example.com/steal', BASE)).toBe(BASE)
  })

  it('refuses a non-https studio host', () => {
    expect(resolveTrustedRedirect('http://x-studio.213.47.80.26.sslip.io/', BASE)).toBe(BASE)
  })

  it('refuses a sibling project host that is not a studio host', () => {
    // The API hosts are not login destinations.
    expect(resolveTrustedRedirect('https://project101-of-org202.213.47.80.26.sslip.io/', BASE)).toBe(
      BASE
    )
  })

  it('refuses javascript: and data: URLs', () => {
    expect(resolveTrustedRedirect('javascript:alert(1)', BASE)).toBe(BASE)
    expect(resolveTrustedRedirect('data:text/html,<script>x</script>', BASE)).toBe(BASE)
  })

  it('falls back on a malformed URL', () => {
    expect(resolveTrustedRedirect('http://[', BASE)).toBe(BASE)
  })

  it('is not fooled by userinfo in the URL', () => {
    // `https://<trusted-host>@evil.com/` parses with hostname evil.com, so a check that looks at the
    // raw string rather than the parsed hostname would be fooled. This must fall back.
    const studioHost = STUDIO.replace('https://', '')
    expect(resolveTrustedRedirect(`https://${studioHost}@evil.example.com/`, BASE)).toBe(BASE)
  })

  it('allows a benign userinfo form because the hostname is still the studio host', () => {
    const studioHost = STUDIO.replace('https://', '')
    expect(resolveTrustedRedirect(`https://x@${studioHost}/project/default`, BASE)).toBe(
      `${STUDIO}/project/default`
    )
  })
})
