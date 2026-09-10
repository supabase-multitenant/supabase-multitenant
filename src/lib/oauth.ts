/**
 * OAuth sign-in gating.
 *
 * The panel is invite-only. Email/password registration already enforces that,
 * but an OAuth provider does not: with a bare provider configured, Auth.js and
 * its Prisma adapter will happily *create* an account for any stranger who
 * completes the provider's flow. That would quietly turn an invite-only panel
 * into a public one.
 *
 * So every OAuth attempt must pass this gate, and it is a gate on two things:
 *
 *  1. **The provider must have verified the address.** Account linking is only
 *     safe when the provider vouches for the email. Without this check, someone
 *     who can register an unverified address matching an existing user's could
 *     attach their OAuth identity to that account — an account takeover.
 *  2. **The address must already be known** — an existing account, or a pending
 *     invitation. Unknown addresses are refused rather than auto-registered.
 *
 * Kept pure and separate from Auth.js so the rules can be tested directly.
 */

export type OAuthProviderId = 'google' | 'github'

export interface OAuthGateInput {
  provider: string
  /** Address the provider reported. */
  email?: string | null
  /**
   * The provider's verdict on that address:
   *   true  — verified by the provider
   *   false — the provider says it is NOT verified
   *   null  — the provider does not report this at all (GitHub)
   */
  emailVerified?: boolean | null
  /** Is there already a panel account for this address? */
  existingUser: boolean
  /** Our own record: has this address been verified in the panel? (User.emailVerified) */
  knownAddressVerified?: boolean
  /** Is there a pending, unexpired invitation for this address? */
  pendingInvitation: boolean
}

export type OAuthDenyCode =
  | 'no_email'
  | 'email_unverified'
  | 'invite_only'
  | 'provider_unverified'

export type OAuthGateResult =
  | { allow: true; reason: 'existing-account' | 'invited' }
  | { allow: false; code: OAuthDenyCode; reason: string }

/**
 * Decide whether an OAuth sign-in may proceed.
 *
 * Credentials sign-ins are authorised inside their own provider and are not
 * routed through here.
 */
export function evaluateOAuthSignIn(input: OAuthGateInput): OAuthGateResult {
  if (input.provider === 'credentials') {
    return { allow: true, reason: 'existing-account' }
  }

  const email = input.email?.trim().toLowerCase()
  if (!email) {
    return {
      allow: false,
      code: 'no_email',
      reason: 'That account did not share an email address, so it cannot be matched to a user.',
    }
  }

  // A provider that explicitly says "not verified" is always refused. Linking an
  // identity to an existing account on the strength of an unverified address is
  // how an account takeover happens.
  if (input.emailVerified === false) {
    return {
      allow: false,
      code: 'email_unverified',
      reason:
        "That account's email address is not verified by the provider, so it cannot be used to sign in.",
    }
  }

  const known = input.existingUser || input.pendingInvitation

  if (input.emailVerified === true) {
    // Provider vouched for it. It still has to be an address we already know,
    // otherwise this would be open self-registration.
    return known
      ? { allow: true, reason: input.existingUser ? 'existing-account' : 'invited' }
      : {
          allow: false,
          code: 'invite_only',
          reason:
            'This panel is invite-only. Ask an administrator to invite this email address first.',
        }
  }

  // The provider reports nothing (GitHub). Fall back to our own record: the
  // address must be known here, and either verified in the panel or carrying a
  // live invitation from an administrator.
  if (known && (input.knownAddressVerified || input.pendingInvitation)) {
    return { allow: true, reason: input.existingUser ? 'existing-account' : 'invited' }
  }

  if (!known) {
    return {
      allow: false,
      code: 'invite_only',
      reason:
        'This panel is invite-only. Ask an administrator to invite this email address first.',
    }
  }

  return {
    allow: false,
    code: 'provider_unverified',
    reason:
      'That provider does not confirm email verification, and this address is not marked as verified here.',
  }
}

/** Provider credentials, read from the environment. */
export const OAUTH_ENV = {
  google: { id: 'AUTH_GOOGLE_ID', secret: 'AUTH_GOOGLE_SECRET' },
  github: { id: 'AUTH_GITHUB_ID', secret: 'AUTH_GITHUB_SECRET' },
} as const

export type OAuthEnv = Record<string, string | undefined>

/** A provider should only be advertised when both halves of its credentials exist. */
export function isOAuthProviderConfigured(
  provider: OAuthProviderId,
  env: OAuthEnv = process.env
): boolean {
  const keys = OAUTH_ENV[provider]
  return Boolean(env[keys.id]?.trim() && env[keys.secret]?.trim())
}

/** The providers actually available, for the sign-in screen. */
export function configuredOAuthProviders(env: OAuthEnv = process.env): OAuthProviderId[] {
  return (['google', 'github'] as OAuthProviderId[]).filter((p) => isOAuthProviderConfigured(p, env))
}

/** The callback URL to register with the provider, e.g. in Google Cloud. */
export function oauthRedirectUri(origin: string, provider: OAuthProviderId): string {
  return `${origin.replace(/\/+$/, '')}/api/auth/callback/${provider}`
}
