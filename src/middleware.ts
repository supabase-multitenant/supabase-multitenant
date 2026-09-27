import { NextRequest, NextResponse } from 'next/server'
import { resolveCookieDomain } from '@/lib/cookie-domain'
import { SESSION_COOKIE_NAME, legacyCookiesToClear } from '@/lib/session-cookie'

// Derived once, exactly as `src/auth.ts` derives it, so the cleanup below can expire a
// domain-scoped cookie as well as a host-only one.
const sessionCookieDomain = resolveCookieDomain({
  authUrl: process.env.AUTH_URL || process.env.NEXTAUTH_URL,
  explicit: process.env.AUTH_COOKIE_DOMAIN,
})

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
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value)

  // Cookies this application no longer reads are expired on the way out. Nothing depends on them —
  // the session cookie is a different name now — so this is hygiene: it stops every request carrying
  // a dead cookie forever, and it means a session list shows one session cookie rather than two.
  //
  // Both shapes are expired deliberately. A cookie written before the session was scoped to the
  // parent domain is host-only, and `Set-Cookie` without a `Domain` cannot delete a domain-scoped
  // cookie (nor the other way round), so a browser that holds either kind ends up clean.
  const staleCookies = legacyCookiesToClear(request.cookies.getAll().map((c) => c.name))
  const finish = (response: NextResponse): NextResponse => {
    for (const name of staleCookies) {
      response.cookies.set(name, '', { path: '/', maxAge: 0 })
      if (sessionCookieDomain) {
        response.cookies.set(name, '', { path: '/', maxAge: 0, domain: sessionCookieDomain })
      }
    }
    return response
  }

  // --- Studio subdomain (header injected by Traefik) ----------------------
  if (gwPrefix) {
    if (hasSession) {
      if (pathname.startsWith(gwPrefix)) return finish(NextResponse.next())
      const url = request.nextUrl.clone()
      // No trailing slash on the bare root (Next would 308-normalize it back
      // into a redirect loop).
      url.pathname = pathname === '/' ? gwPrefix : `${gwPrefix}${pathname}`
      return finish(NextResponse.rewrite(url))
    }
    // Unauthenticated: let the panel serve login + its own assets.
    if (
      pathname.startsWith('/auth') ||
      pathname.startsWith('/api') ||
      pathname.startsWith('/_next')
    ) {
      return finish(NextResponse.next())
    }
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return finish(NextResponse.redirect(loginUrl))
  }

  // --- Panel UI -----------------------------------------------------------
  if (pathname.startsWith('/auth/login') || pathname.startsWith('/auth/register')) {
    return finish(NextResponse.next())
  }
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/gateway')) {
    if (!hasSession) {
      const loginUrl = new URL('/auth/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return finish(NextResponse.redirect(loginUrl))
    }
  }
  return finish(NextResponse.next())
}

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
}
