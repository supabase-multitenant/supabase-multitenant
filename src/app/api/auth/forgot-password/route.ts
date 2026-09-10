import { NextRequest, NextResponse } from 'next/server'
import {
  NEUTRAL_RESET_MESSAGE,
  buildResetUrl,
  requestReset,
} from '@/lib/password-reset'
import { resolveOrigin } from '@/lib/invitations'
import { recordAudit } from '@/lib/access'

/**
 * Is an email transport configured?
 *
 * Until it is, a reset link cannot be delivered by mail, so the only way to make
 * the feature usable is to hand the link back to the caller.
 *
 * That trades one property away: when the link is returned, its presence reveals
 * whether the address has an account, which is an enumeration leak. It is a
 * deliberate, documented tradeoff for a self-hosted, invite-only panel rather
 * than a hidden one — and it disappears the moment SMTP is configured, because
 * then the link is mailed and never returned.
 */
function mailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST || process.env.SMTP_URL || process.env.RESEND_API_KEY
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const email = typeof body?.email === 'string' ? body.email : ''

    const result = await requestReset(email)

    // Audit only when there was something to audit — the log is not the response,
    // so recording the truth here does not leak anything to the caller.
    if (result.token) {
      await recordAudit({
        action: 'auth.password_reset_requested',
        targetType: 'user',
        metadata: { email: email.trim().toLowerCase() },
      })
    }

    const canMail = mailConfigured()
    const origin = resolveOrigin({
      authUrl: process.env.AUTH_URL ?? process.env.NEXTAUTH_URL,
      forwardedProto: request.headers.get('x-forwarded-proto'),
      host: request.headers.get('host'),
      fallback: request.nextUrl.origin,
    })

    return NextResponse.json({
      // Always the same message: it must not depend on whether the account exists.
      message: NEUTRAL_RESET_MESSAGE,
      delivery: canMail ? 'email' : 'link',
      ...(result.token && !canMail
        ? {
            resetUrl: buildResetUrl(origin, result.token),
            note: 'No mail transport is configured, so the link is shown here instead of emailed.',
          }
        : {}),
    })
  } catch (error) {
    console.error('Request password reset error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
