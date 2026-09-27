import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LANDING,
  SYSTEM_LANDING,
  landingFor,
  requestedPath,
  resolveLanding,
} from '@/lib/landing'

describe('where an account lands after signing in', () => {
  it('sends a platform administrator to the system view', () => {
    expect(landingFor(true)).toBe(SYSTEM_LANDING)
    expect(resolveLanding(null, true)).toBe('/admin')
  })

  it('sends an ordinary member to their organizations', () => {
    expect(landingFor(false)).toBe(DEFAULT_LANDING)
    expect(resolveLanding(null, false)).toBe('/organizations')
  })

  it('honours an explicit destination, for either kind of account', () => {
    // Someone who followed a link to a page must arrive at that page, not at their default.
    expect(resolveLanding('/projects', true)).toBe('/projects')
    expect(resolveLanding('/projects', false)).toBe('/projects')
    expect(resolveLanding('/admin', false)).toBe('/admin')
  })
})

describe('a destination that arrives in the query string is not trusted', () => {
  it('refuses anything that is not a path on this site', () => {
    for (const next of [
      'https://evil.example/steal',
      'http://evil.example',
      'evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>',
      '',
      '   ',
    ]) {
      expect(requestedPath(next)).toBeNull()
    }
  })

  it('refuses protocol-relative and backslash forms, which a browser reads as a host', () => {
    // `//evil.example` is a host, not a path, and several browsers normalise `/\` to the same thing.
    expect(requestedPath('//evil.example')).toBeNull()
    expect(requestedPath('/\\evil.example')).toBeNull()
    expect(requestedPath('/\\/evil.example')).toBeNull()
  })

  it('falls back to the role default rather than following a refused target', () => {
    expect(resolveLanding('//evil.example', true)).toBe('/admin')
    expect(resolveLanding('//evil.example', false)).toBe('/organizations')
  })

  it('passes an ordinary path through unchanged', () => {
    expect(requestedPath('/dashboard')).toBe('/dashboard')
    expect(requestedPath('/organizations/atlas-labs')).toBe('/organizations/atlas-labs')
    expect(requestedPath('/a?b=c')).toBe('/a?b=c')
  })

  it('accepts absent and non-string values without inventing a path', () => {
    expect(requestedPath(null)).toBeNull()
    expect(requestedPath(undefined)).toBeNull()
    expect(requestedPath(7 as never)).toBeNull()
  })
})
