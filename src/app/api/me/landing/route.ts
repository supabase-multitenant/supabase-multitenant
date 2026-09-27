import { NextResponse } from 'next/server'

import { getSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { landingFor, requestedPath } from '@/lib/landing'
import { isSystemAdmin } from '@/lib/system-admin'

export const dynamic = 'force-dynamic'

/**
 * Where this session should land after signing in.
 *
 * The role is re-read from `users.role` rather than taken from the session token: a token carries
 * the role it was minted with, so a demotion would otherwise leave someone landing on the system
 * view until their token expired.
 *
 * `next` may be supplied to ask the same question the sign-in form is about to ask — an explicit
 * destination always wins — so the client does not have to reimplement the safety check.
 */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true, disabled: true },
  })

  // A disabled or missing account is not an administrator, whatever its stored role says.
  const systemAdmin =
    record !== null && !record.disabled && isSystemAdmin(record.role)

  const next = new URL(request.url).searchParams.get('next')
  const destination = requestedPath(next) ?? landingFor(systemAdmin)

  return NextResponse.json({ destination, systemAdmin })
}
