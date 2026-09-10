import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'
import { prisma } from '@/lib/db'

// App-level Studio gateway. Per-project Studio containers expose no auth of
// their own; this is the single authenticated entry point. It validates the
// panel admin session, then reverse-proxies to the target project's Studio.
//
// Usage (all methods proxied):
//   /gateway/studio/<projectSlug>/<rest...>
//
// The pretty subdomain (e.g. playgroundsb1-studio.<host>) is rewritten here by
// src/middleware.ts, so Studio's absolute asset paths (/_next/..., /project/...)
// resolve at the subdomain root and keep the pretty URL.

const HOST_GATEWAY = process.env.HOST_GATEWAY || '10.0.2.1'

interface RouteContext {
  params: Promise<{ slug: string; rest?: string[] }>
}

// Redirect to the panel login WITHOUT baking in the container's internal URL.
// A relative Location resolves against whatever public host the browser used
// (previously this emitted http://0.0.0.0:3000/... which is unreachable).
function loginRedirect(_request: NextRequest, pathname: string): Response {
  const next = encodeURIComponent(pathname)
  return new Response(null, {
    status: 307,
    headers: { location: `/auth/login?next=${next}` },
  })
}

async function handle(request: NextRequest, ctx: RouteContext): Promise<Response> {
  const { slug, rest } = await ctx.params

  // App-level auth gate (the panel's own session).
  const token = request.cookies.get('session')?.value
  if (!token || !(await validateSession(token))) {
    return loginRedirect(request, request.nextUrl.pathname)
  }

  const project = await prisma.project.findUnique({
    where: { slug },
    include: { envVars: true },
  })
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const envMap = Object.fromEntries(project.envVars.map((e) => [e.key, e.value]))
  const studioPort = envMap.STUDIO_PORT || '3000'

  const upstreamPath = rest && rest.length ? `/${rest.join('/')}` : '/'
  const target = new URL(upstreamPath, `http://${HOST_GATEWAY}:${studioPort}`)
  const query = request.nextUrl.searchParams.toString()
  if (query) target.search = `?${query}`

  const headers = new Headers()
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (k === 'host' || k === 'content-length' || k === 'connection') return
    headers.set(key, value)
  })
  headers.set('host', `${slug}-studio`)

  const init: RequestInit = { method: request.method, headers, redirect: 'manual' }
  if (!['GET', 'HEAD'].includes(request.method)) {
    try {
      const ab = await request.arrayBuffer()
      if (ab.byteLength > 0) init.body = ab
    } catch {
      /* no body */
    }
  }

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), init)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: 'Studio gateway unreachable', detail: msg },
      { status: 502 },
    )
  }

  const out = new NextResponse(upstream.body, { status: upstream.status })
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (k === 'content-length' || k === 'connection' || k === 'content-encoding') return
    // Keep redirects relative so the browser stays on the pretty subdomain.
    if (k === 'location' && value.startsWith('http')) {
      try {
        const u = new URL(value)
        out.headers.set('location', u.pathname + u.search)
        return
      } catch {
        /* fall through */
      }
    }
    out.headers.set(key, value)
  })
  return out
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  return handle(request, ctx)
}
export async function POST(request: NextRequest, ctx: RouteContext) {
  return handle(request, ctx)
}
export async function PUT(request: NextRequest, ctx: RouteContext) {
  return handle(request, ctx)
}
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  return handle(request, ctx)
}
export async function DELETE(request: NextRequest, ctx: RouteContext) {
  return handle(request, ctx)
}
