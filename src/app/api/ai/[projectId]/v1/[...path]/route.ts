import { NextRequest, NextResponse } from 'next/server'

import { AI_SETTING_KEYS, findProvider, needsModelRewrite } from '@/lib/ai-providers'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * OpenAI-compatible relay for a project's Studio assistant.
 *
 * Studio is given `OPENAI_BASE_URL=<panel>/api/ai/<projectId>/v1` and an internal token as its key.
 * Requests arrive here, the hard-coded model id is replaced with the model the project configured,
 * and the call is forwarded to the real provider with the real key.
 *
 * Deliberately a relay rather than a translator: DeepSeek and the other presets serve the same
 * Responses API Studio speaks, streaming included, so nothing is converted. The full extent of the
 * work here is one JSON field — which is what makes this a route instead of a service.
 *
 * The provider key never reaches the Studio container, and a request without the project's token is
 * refused, so this cannot be used as a relay by anyone who discovers the URL.
 */

/** Paths Studio is allowed to reach. Anything else is not part of the assistant's traffic. */
const ALLOWED_PATHS = new Set(['responses', 'chat/completions', 'models'])

/** A body larger than this is not an assistant request. */
const MAX_BODY_BYTES = 1024 * 1024

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; path: string[] }> }
) {
  const { projectId, path } = await params
  const target = path.join('/')

  if (!ALLOWED_PATHS.has(target)) {
    return NextResponse.json({ error: { message: `Unsupported path: ${target}` } }, { status: 404 })
  }

  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!presented) {
    return NextResponse.json({ error: { message: 'Missing API key' } }, { status: 401 })
  }

  const rows = await prisma.projectEnvVar.findMany({
    where: {
      projectId,
      key: { in: [AI_SETTING_KEYS.provider, AI_SETTING_KEYS.apiKey, AI_SETTING_KEYS.baseUrl, AI_SETTING_KEYS.model, AI_SETTING_KEYS.token] },
    },
    select: { key: true, value: true },
  })
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]))

  const token = settings[AI_SETTING_KEYS.token] ?? ''
  const apiKey = settings[AI_SETTING_KEYS.apiKey] ?? ''
  if (!token || !apiKey) {
    return NextResponse.json(
      { error: { message: 'No AI provider is configured for this project.' } },
      { status: 409 }
    )
  }
  // The token identifies the project. Without it a member of any other project — or a stranger —
  // could spend this project's credits.
  if (!timingSafeEqual(presented, token)) {
    return NextResponse.json({ error: { message: 'Invalid API key' } }, { status: 401 })
  }

  const providerId = settings[AI_SETTING_KEYS.provider] ?? 'openai'
  const provider = findProvider(providerId)
  const baseUrl = (settings[AI_SETTING_KEYS.baseUrl] || provider?.baseUrl || '').replace(/\/+$/, '')
  if (!baseUrl) {
    return NextResponse.json(
      { error: { message: `No base URL configured for provider "${providerId}".` } },
      { status: 409 }
    )
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { message: 'Request too large' } }, { status: 413 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: { message: 'Invalid JSON body' } }, { status: 400 })
  }

  // The whole point: Studio sends a model id the provider does not recognise.
  const configuredModel = settings[AI_SETTING_KEYS.model] ?? ''
  if (needsModelRewrite(providerId) && configuredModel) {
    payload.model = configuredModel
  }

  try {
    const upstream = await fetch(`${baseUrl}/${target}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      // The assistant streams; a buffered response would stall the UI until the whole answer exists.
      signal: request.signal,
    })

    // Streamed through unchanged, including SSE. The status and content type are what Studio reads;
    // the body may be a stream, so it is passed as a stream rather than parsed.
    const headers = new Headers()
    const contentType = upstream.headers.get('content-type')
    if (contentType) headers.set('Content-Type', contentType)
    headers.set('Cache-Control', 'no-store')

    return new NextResponse(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message: `Could not reach ${provider?.label ?? providerId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        },
      },
      { status: 502 }
    )
  }
}
