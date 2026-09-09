import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * GET /api/auth/registration-status
 * Returns whether new user registration is allowed.
 * Registration is only allowed when there are no users in the system.
 */
export async function GET() {
    try {
        const userCount = await prisma.user.count()

        return NextResponse.json({
            registrationOpen: userCount === 0,
            message: userCount === 0
                ? 'Welcome! Create your admin account to get started.'
                : 'Registration is closed. Contact an administrator to request access.',
        })
    } catch (error) {
        console.error('Registration status check error:', error)
        return NextResponse.json(
            { error: 'Failed to check registration status' },
            { status: 500 }
        )
    }
}
