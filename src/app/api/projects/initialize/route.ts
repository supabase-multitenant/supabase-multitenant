import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'
import { initializeSupabaseCore } from '@/lib/project'

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get('session')?.value
    
    if (!sessionToken) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const session = await validateSession(sessionToken)
    if (!session) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      )
    }

    const result = await initializeSupabaseCore()

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Initialize error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}