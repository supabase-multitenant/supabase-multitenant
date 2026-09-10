import { NextRequest, NextResponse } from 'next/server'

// App-level auth gate + Studio host router.
//
// 1. Panel UI gating (server-side). /dashboard was previously client-guarded
//    only; this enforces the panel's own session cookie before the page serves.
//
// 2. Pretty per-project Studio subdomain. Traefik injects the header
//    `x-studio-gateway: /gateway/studio/<slug>` on the project's Studio
//    subdomain. We REWRITE internally (not redirect) so the browser keeps the
//    pretty URL and Studio's absolute asset paths (/_next/..., /project/...)
//    resolve at the subdomain root. The gateway route validates the session.
//
//    Authenticated  -> rewrite to the gateway (Studio through the panel).
//    Unauthenticated-> bounce to the panel login; the panel's auth pages and
//                      their assets are served un-rewritten so login works.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const gwPrefix = request.headers.get('x-studio-gateway')
  const hasSession = Boolean(request.cookies.get('session')?.value)

  // --- Studio subdomain (header injected by Traefik) ----------------------
  if (gwPrefix) {
    if (hasSession) {
      if (pathname.startsWith(gwPrefix)) return NextResponse.next()
      const url = request.nextUrl.clone()
      // No trailing slash on the bare root (Next would 308-normalize it back
      // into a redirect loop).
      url.pathname = pathname === '/' ? gwPrefix : `${gwPrefix}${pathname}`
      return NextResponse.rewrite(url)
    }
    // Unauthenticated: let the panel serve login + its own assets.
    if (
      pathname.startsWith('/auth') ||
      pathname.startsWith('/api') ||
      pathname.startsWith('/_next')
    ) {
      return NextResponse.next()
    }
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // --- Panel UI -----------------------------------------------------------
  if (pathname.startsWith('/auth/login') || pathname.startsWith('/auth/register')) {
    return NextResponse.next()
  }
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/gateway')) {
    if (!hasSession) {
      const loginUrl = new URL('/auth/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
}
