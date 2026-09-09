import { NextRequest, NextResponse } from 'next/server'

// App-level auth gate for the panel UI and the Studio gateway.
// This is a cheap edge check (cookie present). The REAL validation happens in
// the /gateway/[...path] route handler (Prisma-backed), which is the layer that
// actually decides whether to proxy to a project's Studio. Middleware just
// stops obviously-unauthenticated clients before they hit the server.
//
// Matched paths:
//   /dashboard/**  - panel UI (previously client-side only)
//   /gateway/**    - per-project Studio proxy (added now)
//   /auth/register - registration is closed after the first admin
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public auth pages should always be reachable.
  if (pathname.startsWith('/auth/login') || pathname.startsWith('/auth/register')) {
    return NextResponse.next()
  }

  const hasSession = request.cookies.get('session')?.value

  // Dashboard + gateway require an authenticated session.
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/gateway')) {
    if (!hasSession) {
      const loginUrl = new URL('/auth/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  // Run on the panel UI + gateway paths only.
  matcher: [
    '/dashboard/:path*',
    '/gateway/:path*',
    '/auth/login',
    '/auth/register',
  ],
}
