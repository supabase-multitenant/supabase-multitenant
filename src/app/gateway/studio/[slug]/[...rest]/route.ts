import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'
import { prisma } from '@/lib/db'

// App-level Studio gateway. The per-project Studio containers expose no auth of
// their own and (if port-mapped) are reachable directly from the network. This
// route is the SINGLE authenticated entry point: it validates the panel admin
// session, then reverse-proxies the request to the target project's Studio.
//
// Usage (all methods proxied):
//   /gateway/studio/<projectSlug>/<rest...>
//
// The panel reaches each Studio via the host docker gateway on the project's
// published Studio port. The host gateway IP is injected at runtime; it must be
// reachable from the panel container.

// Note: these are read once at cold start; override via env if the gateway IP
// differs per environment.
const HOST_GATEWAY = process.env.HOST_GATEWAY || '10.0.2.1'

interface RouteContext {
  params: Promise<{ slug: string; rest: string[] }>
}

async function proxyToStudio(
  slug: string,
  rest: string[],
  request: NextRequest,
): Promise<NextResponse> {
  // 1. Look up the project and its env vars (for the Studio port).
  const project = await prisma.project.findUnique({
    where: { slug },
    include: { envVars: true },
  })
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const envMap = Object.fromEntries(
    project.envVars.map((e) => [e.key, e.value]),
  )
  const studioPort = envMap.STUDIO_PORT || '3000'

  // 2. Build the upstream URL.
  const upstreamPath = rest.length ? `/${rest.join('/')}` : '/'
  const target = new URL(`${upstreamPath}`, `http://${HOST_GATEWAY}:${studioPort}`)
  const query = request.nextUrl.searchParams.toString()
  if (query) target.search = `?${query}`

  // 3. Forward the request (method, body, key headers).
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    // strip hop-by-hop + host + anything that would break the stream
    if (['host', 'content-length', 'connection'].includes(key.toLowerCase())) return
    headers.set(key, value)
  })
  headers.set('host', `${slug}-studio`)

  const init: RequestInit = { method: request.method, headers }
  const hasBody = !['GET', 'HEAD'].includes(request.method)
  if (hasBody) {
    try {
      const ab = await request.arrayBuffer()
      if (ab.byteLength > 0) init.body = ab
    } catch {
      // no body
    }
  }

  // 4. Fetch and stream back the response.
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
    if (['content-length', 'connection', 'content-encoding'].includes(key.toLowerCase())) return
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

async function handle(request: NextRequest, ctx: RouteContext) {
  // Auth gate — this is the core difference from a raw exposed Studio.
  const token = request.cookies.get('session')?.value
  if (!token) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }
  const session = await validateSession(token)
  if (!session) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  const { slug, rest } = await ctx.params
  return proxyToStudio(slug, rest || [], request)
}
