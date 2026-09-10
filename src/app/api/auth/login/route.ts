import { NextRequest, NextResponse } from 'next/server'

/**
 * Legacy endpoint. Sign-in is handled by Auth.js at
 * `/api/auth/callback/credentials`; kept only to return a clear error instead of
 * a confusing 404 for any old clients/bookmarks.
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: 'Deprecated. Use the Auth.js sign-in flow (/auth/login).' },
    { status: 410 },
  )
}
