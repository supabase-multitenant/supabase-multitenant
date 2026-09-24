import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { validateSession } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getProjectsBasePath } from '@/lib/paths'

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

  // Studio is reached through the project's SHARED gateway listener (ADR-0003), not a port of its
  // own. Two things the old code got wrong and this fixes:
  //
  //   1. It targeted STUDIO_PORT, which the template writes into .env but nothing ever publishes —
  //      so this route could never connect, for any project, before or after the cutover.
  //   2. It set `host: <slug>-studio`. The per-project envoy accepted `domains: ['*']` so that
  //      worked; the shared gateway matches the tenant by its PUBLIC host, so that Host would
  //      match no listener and be rejected.
  //
  // GW_HTTP_PORT is the host port of this tenant's listener on the shared gateway, and
  // GW_PUBLIC_HOST is the host it answers for. Both are written per project at creation.
  const gatewayPort = envMap.GW_HTTP_PORT || envMap.STUDIO_PORT || '3000'
  const gatewayHost = envMap.GW_PUBLIC_HOST || `${slug}.localhost`

  const upstreamPath = rest && rest.length ? `/${rest.join('/')}` : '/'

  // Studio answers `/` itself with a redirect to `/project/<default>`, but that redirect loses the
  // panel's `/gateway/studio/<slug>` prefix on the return trip, so the browser lands on a 404. Send
  // the browser straight to the project path, keeping it inside this route so every asset URL stays
  // prefix-correct.
  if (!rest || rest.length === 0) {
    // Opening Studio is what makes the dashboard group wanted (ADR-0003 phase 4): studio + meta are
    // the most expensive optional services, so they stay stopped until somebody actually looks at
    // them. Done here rather than on every asset request so it costs one check per Studio open.
    try {
      const { ENABLED_SERVICES_KEY, applyServiceGroups, parseEnabledGroups } = await import(
        '@/lib/service-groups'
      )
      const enabled = parseEnabledGroups(envMap[ENABLED_SERVICES_KEY])
      if (!enabled.includes('dashboard')) {
        await applyServiceGroups({
          projectDir: path.join(getProjectsBasePath(), project.slug, 'docker'),
          groups: [...enabled, 'dashboard'],
        })
      }
    } catch (error) {
      // Starting Studio must not block reaching Studio; if it fails the proxy below reports it.
      console.warn('Could not start the dashboard service group:', error)
    }

    return new Response(null, {
      status: 307,
      headers: { location: `/gateway/studio/${slug}/project/default` },
    })
  }

  const target = new URL(upstreamPath, `http://${HOST_GATEWAY}:${gatewayPort}`)
  const query = request.nextUrl.searchParams.toString()
  if (query) target.search = `?${query}`

  // Forward a deliberate allowlist, not "everything except host".
  //
  // The old code copied every browser header through. The gateway template matches SOME routes on
  // headers, so an unrelated browser header could select a different route than the path implies —
  // which is how this endpoint returned `403 RBAC: access denied` for a request a plain curl served
  // fine. A fixed list removes that whole class of surprise, and stops leaking the panel's own
  // cookies and auth headers to a tenant's container.
  const FORWARDED = [
    'accept',
    'accept-language',
    'content-type',
    'range',
    'if-match',
    'if-none-match',
    'if-modified-since',
  ]
  const headers = new Headers()
  for (const name of FORWARDED) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('host', gatewayHost)

  // Studio sits behind the gateway's basic-auth filter. The panel session is the single
  // authenticated entry point (see the file header), so supply that credential here rather than
  // making the user log in twice. Unset -> Studio prompts for itself.
  const gatewayBasicAuth = process.env.SHARED_GATEWAY_BASIC_AUTH
  if (gatewayBasicAuth) headers.set('authorization', `Basic ${gatewayBasicAuth}`)

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
