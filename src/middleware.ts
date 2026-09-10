import { NextRequest, NextResponse } from 'next/server'

// App-level auth gate + Studio host router.
//
// Two responsibilities:
//
// 1. Panel UI gating (server-side). Previously /dashboard was only
//    client-guarded; this enforces the panel's own session cookie before the
//    page is served. /gateway (the Studio proxy) is gated the same way.
//
// 2. Pretty per-project Studio subdomain. Traefik injects the header
//    `x-studio-gateway: /gateway/studio/<slug>` for the project's Studio
//    subdomain. We REWRITE (not redirect) internally to that gateway route, so
//    the browser keeps the pretty URL and there is no redirect loop.
//    The gateway route itself validates the session (validateSession).
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // --- Studio subdomain (header injected by Traefik) ----------------------
  const gwPrefix = request.headers.get('x-studio-gateway')
  if (gwPrefix) {
    if (pathname.startsWith(gwPrefix)) {
      // Already on the gateway path; let the route handler serve it.
      return NextResponse.next()
    }
    const url = request.nextUrl.clone()
    // Avoid a trailing slash on the bare root (Next would 308-normalize it and
    // reintroduce a loop). Sub-paths keep their shape.
    url.pathname = pathname === '/' ? gwPrefix : `${gwPrefix}${pathname}`
    return NextResponse.rewrite(url)
  }

  // --- Panel UI -----------------------------------------------------------
  // Public auth pages stay reachable.
  if (pathname.startsWith('/auth/login') || pathname.startsWith('/auth/register')) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/gateway')) {
    if (!request.cookies.get('session')?.value) {
      const loginUrl = new URL('/auth/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  // Run broadly so Studio subdomain assets (_next/static, etc.) are rewritten
  // too; the function early-returns cheaply for unrelated paths.
  matcher: ['/((?!favicon.ico).*)'],
}
