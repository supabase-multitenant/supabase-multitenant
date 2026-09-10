import { NextRequest, NextResponse } from 'next/server'
import { initializeSupabaseCore } from '@/lib/project'
import { recordAudit, requirePanelOwner } from '@/lib/access'

/**
 * Bootstrap the shared Supabase core on this host.
 *
 * A machine-level operation, not an organization one: restricted to the panel
 * owner rather than any authenticated user.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requirePanelOwner(request)
    if (auth.response) return auth.response

    const result = await initializeSupabaseCore()

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    await recordAudit({
      action: 'system.initialize_core',
      actorId: auth.session.user.id,
      actorEmail: auth.session.user.email,
      targetType: 'system',
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Initialize error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
