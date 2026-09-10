import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/auth'

/**
 * Registration.
 *
 * The very first account bootstraps the panel and becomes its owner.
 * After that, registration is **invite-only**: a valid, unexpired invitation for
 * the exact address is the ticket in. That is what makes an invitation link
 * usable by someone who has no account yet.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const normalizedEmail = String(email).toLowerCase()
    const userCount = await prisma.user.count()

    if (userCount > 0) {
      const invitation = await prisma.invitation.findFirst({
        where: {
          email: normalizedEmail,
          status: 'pending',
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      })

      if (!invitation) {
        return NextResponse.json(
          {
            error: 'Registration is invite-only.',
            hint: 'Ask an administrator to invite this email address first.',
          },
          { status: 403 }
        )
      }
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })
    if (existingUser) {
      return NextResponse.json({ error: 'User already exists' }, { status: 400 })
    }

    const hashedPassword = await hashPassword(password)

    // Only the bootstrapping account is a global owner; everyone else joins
    // through an organization membership.
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        name: name || null,
        role: userCount === 0 ? 'owner' : 'member',
        emailVerified: new Date(),
      },
    })

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    })
  } catch (error) {
    console.error('Register error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
