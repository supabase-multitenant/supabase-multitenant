import { NextResponse } from 'next/server'
import { signOut } from '@/auth'

/**
 * Sign out via Auth.js. Clears the `session` cookie (JWT strategy) and removes
 * any adapter session row when present.
 */
export async function POST() {
  try {
    await signOut({ redirect: false })
    const response = NextResponse.json({ success: true })
    response.cookies.delete('session')
    return response
  } catch (error) {
    console.error('Logout error:', error)
    const response = NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    response.cookies.delete('session')
    return response
  }
}
