import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './db'
import { validateSession } from './auth'

/**
 * Shared session + project-access helpers for API routes.
 *
 * Access rule: a project is reachable by its owner, by the owner of the
 * organization it belongs to, or by any member of that organization. That is
 * what lets other developers sign in and inspect a database without being
 * handed the owner's account.
 */

export type Session = Awaited<ReturnType<typeof validateSession>>

export async function getSession(request: NextRequest): Promise<Session> {
  const token = request.cookies.get('session')?.value
  if (!token) return null
  return validateSession(token)
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function notFound(what = 'Project'): NextResponse {
  return NextResponse.json({ error: `${what} not found` }, { status: 404 })
}

/** Prisma filter for "projects this user may see". */
export function projectAccessFilter(userId: string) {
  return {
    OR: [
      { ownerId: userId },
      {
        organization: {
          OR: [
            { ownerId: userId },
            { members: { some: { userId } } },
          ],
        },
      },
    ],
  }
}

/**
 * Resolve the caller and a project they are allowed to see.
 * Returns either `{ session, project }` or `{ response }` to return as-is.
 */
export async function loadAccessibleProject(
  request: NextRequest,
  projectId: string
): Promise<
  | { session: NonNullable<Session>; project: { id: string; slug: string; status: string; ownerId: string; name: string }; response?: never }
  | { response: NextResponse; session?: never; project?: never }
> {
  const session = await getSession(request)
  if (!session) return { response: unauthorized() }

  const project = await prisma.project.findFirst({
    where: { id: projectId, ...projectAccessFilter(session.user.id) },
    select: { id: true, slug: true, status: true, ownerId: true, name: true },
  })
  if (!project) return { response: notFound() }

  return { session, project }
}
