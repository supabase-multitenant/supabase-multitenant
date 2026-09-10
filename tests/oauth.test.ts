import { describe, expect, it } from 'vitest'

import {
  OAUTH_ENV,
  configuredOAuthProviders,
  evaluateOAuthSignIn,
  isOAuthProviderConfigured,
  oauthRedirectUri,
} from '@/lib/oauth'

/** A Google sign-in: the provider reports verification explicitly. */
const google = {
  provider: 'google',
  email: 'alex@example.com',
  emailVerified: true,
  existingUser: false,
  knownAddressVerified: false,
  pendingInvitation: false,
}

/** A GitHub sign-in: the provider reports no verification flag at all. */
const github = { ...google, provider: 'github', emailVerified: null }

describe('oauth gate — who may sign in', () => {
  it('permits a known account whose provider-verified email matches', () => {
    expect(evaluateOAuthSignIn({ ...google, existingUser: true }).allow).toBe(true)
  })

  it('permits an invited address so onboarding can finish', () => {
    expect(evaluateOAuthSignIn({ ...google, pendingInvitation: true })).toEqual({
      allow: true,
      reason: 'invited',
    })
  })

  it('refuses a stranger — this is what keeps the panel invite-only', () => {
    const r = evaluateOAuthSignIn(google)
    expect(r.allow).toBe(false)
    expect(r.allow === false && r.reason).toMatch(/invite-only/i)
  })

  it('refuses an address the provider says is unverified, EVEN when the account exists', () => {
    // The takeover case: an attacker registers an unverified address matching a
    // real user and completes the OAuth flow to attach their identity to it.
    const r = evaluateOAuthSignIn({ ...google, emailVerified: false, existingUser: true })
    expect(r.allow).toBe(false)
    expect(r.allow === false && r.reason).toMatch(/not verified/i)
  })

  it('refuses when the provider shared no address', () => {
    for (const email of [null, '', '   ', undefined]) {
      expect(evaluateOAuthSignIn({ ...google, email, existingUser: true }).allow).toBe(false)
    }
  })

  it('does not care about case or padding in the address', () => {
    expect(evaluateOAuthSignIn({ ...google, email: '  ALEX@Example.COM ', existingUser: true }).allow).toBe(true)
  })

  it('lets credentials through, since they are authorised elsewhere', () => {
    expect(evaluateOAuthSignIn({ ...google, provider: 'credentials' }).allow).toBe(true)
  })
})

describe('oauth gate — providers that report no verification (GitHub)', () => {
  it('permits when our own record shows the address verified', () => {
    expect(
      evaluateOAuthSignIn({ ...github, existingUser: true, knownAddressVerified: true }).allow
    ).toBe(true)
  })

  it('refuses an existing account that is not verified here either', () => {
    const r = evaluateOAuthSignIn({ ...github, existingUser: true, knownAddressVerified: false })
    expect(r.allow).toBe(false)
    expect(r.allow === false && r.reason).toMatch(/does not confirm email verification/i)
  })

  it('trusts a live invitation from an administrator', () => {
    expect(evaluateOAuthSignIn({ ...github, pendingInvitation: true }).allow).toBe(true)
  })

  it('still refuses a stranger', () => {
    const r = evaluateOAuthSignIn(github)
    expect(r.allow).toBe(false)
    expect(r.allow === false && r.reason).toMatch(/invite-only/i)
  })

  it('refuses a provider that lies about verification being absent vs false', () => {
    // false is an explicit "no" and must never be treated as "unknown".
    expect(evaluateOAuthSignIn({ ...github, emailVerified: false, existingUser: true, knownAddressVerified: true }).allow).toBe(false)
  })
})

describe('provider configuration', () => {
  it('requires both halves of the credentials', () => {
    expect(isOAuthProviderConfigured('google', {})).toBe(false)
    expect(isOAuthProviderConfigured('google', { AUTH_GOOGLE_ID: 'id' })).toBe(false)
    expect(isOAuthProviderConfigured('google', { AUTH_GOOGLE_SECRET: 'secret' })).toBe(false)
    expect(isOAuthProviderConfigured('google', { AUTH_GOOGLE_ID: 'id', AUTH_GOOGLE_SECRET: 's' })).toBe(true)
  })

  it('treats blank values as absent', () => {
    expect(isOAuthProviderConfigured('google', { AUTH_GOOGLE_ID: '  ', AUTH_GOOGLE_SECRET: ' ' })).toBe(false)
  })

  it('uses distinct variables per provider', () => {
    expect(OAUTH_ENV.google.id).toBe('AUTH_GOOGLE_ID')
    expect(OAUTH_ENV.github.id).toBe('AUTH_GITHUB_ID')
    const env = { AUTH_GITHUB_ID: 'i', AUTH_GITHUB_SECRET: 's' }
    expect(isOAuthProviderConfigured('github', env)).toBe(true)
    expect(isOAuthProviderConfigured('google', env)).toBe(false)
  })

  it('lists only the configured providers, for the sign-in screen', () => {
    expect(configuredOAuthProviders({})).toEqual([])
    expect(configuredOAuthProviders({ AUTH_GOOGLE_ID: 'i', AUTH_GOOGLE_SECRET: 's' })).toEqual(['google'])
    expect(
      configuredOAuthProviders({
        AUTH_GOOGLE_ID: 'i', AUTH_GOOGLE_SECRET: 's',
        AUTH_GITHUB_ID: 'i', AUTH_GITHUB_SECRET: 's',
      })
    ).toEqual(['google', 'github'])
  })

  it('builds the redirect URI to register with the provider', () => {
    expect(oauthRedirectUri('https://panel.example.com', 'google')).toBe(
      'https://panel.example.com/api/auth/callback/google'
    )
    expect(oauthRedirectUri('https://panel.example.com/', 'github')).toBe(
      'https://panel.example.com/api/auth/callback/github'
    )
  })
})
