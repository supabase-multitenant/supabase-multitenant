import { NextResponse } from 'next/server'
import { signOut } from '@/auth'
import { SESSION_COOKIE_NAME } from '@/lib/session-cookie'

/**
 * Sign out via Auth.js. Clears the `session` cookie (JWT strategy) and removes
 * any adapter session row when present.
 */
export async function POST() {
  try {
    await signOut({ redirect: false })
    const response = NextResponse.json({ success: true })
    response.cookies.delete(SESSION_COOKIE_NAME)
    return response
  } catch (error) {
    console.error('Logout error:', error)
    const response = NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    response.cookies.delete(SESSION_COOKIE_NAME)
    return response
  }
}
