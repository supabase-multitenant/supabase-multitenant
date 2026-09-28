import { NextRequest, NextResponse } from 'next/server'

import { AI_PROVIDERS } from '@/lib/ai-providers'
import { clearAiSettings, readAiSettings, saveAiSettings, toView } from '@/lib/ai-settings'
import { recordAudit, requireProjectPermission } from '@/lib/access'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * A project's AI provider configuration — which model the built-in Studio assistant should use and
 * whose key pays for it.
 *
 * Reading is `env:read` because the answer reveals whether a key is on file; writing is `env:write`.
 * The key itself is never returned: the panel shows that one exists, not what it is, so it cannot be
 * read back out of the browser by anyone who can reach the settings screen.
 */

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const auth = await requireProjectPermission(request, id, 'env:read')
    if (auth.response) return auth.response

    return NextResponse.json({
      settings: toView(await readAiSettings(id)),
      providers: AI_PROVIDERS,
    })
  } catch (error) {
    console.error('Get AI settings error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const auth = await requireProjectPermission(request, id, 'env:write')
    if (auth.response) return auth.response

    const body = (await request.json()) as {
      action?: string
      provider?: string
      apiKey?: string
      baseUrl?: string
      model?: string
    }

    const result =
      body.action === 'clear'
        ? await clearAiSettings(id)
        : await saveAiSettings(id, {
            provider: body.provider,
            apiKey: body.apiKey,
            baseUrl: body.baseUrl,
            model: body.model,
          })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    await recordAudit({
      // The provider and model, never the key.
      action: body.action === 'clear' ? 'project.ai_clear' : 'project.ai_write',
      organizationId: auth.project.organizationId,
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'project',
      targetId: id,
      metadata: {
        provider: result.view?.provider ?? null,
        model: result.view?.model ?? null,
        recreated: result.recreated ?? [],
      },
    })

    return NextResponse.json({ settings: result.view, recreated: result.recreated })
  } catch (error) {
    console.error('Save AI settings error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
