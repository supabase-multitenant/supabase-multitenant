import { NextRequest, NextResponse } from 'next/server'
import { consumeReset } from '@/lib/password-reset'
import { recordAudit } from '@/lib/access'

/**
 * Redeem a password reset token.
 *
 * Unauthenticated by design — the whole point is that the person cannot sign in.
 * The token is the credential, and every check (single use, expiry, invalidation
 * of siblings) lives in the library so this route cannot weaken them.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    const password = body?.password

    if (!token) {
      return NextResponse.json({ error: 'A token is required.' }, { status: 400 })
    }

    const result = await consumeReset({ token, newPassword: password })

    await recordAudit({
      action: 'auth.password_reset_completed',
      targetType: 'user',
      targetId: result.userId,
      metadata: { email: result.email },
    })

    return NextResponse.json({
      success: true,
      email: result.email,
      // Sessions are JWTs and cannot be revoked, so a reset does not sign other
      // devices out. Stated plainly rather than implied to be complete.
      message:
        'Your password has been changed. You can sign in with it now. Any session that was already signed in remains valid until it expires.',
    })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not reset the password.' },
        { status }
      )
    }
    console.error('Reset password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
