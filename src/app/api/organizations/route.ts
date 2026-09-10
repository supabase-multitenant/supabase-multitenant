import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

/**
 * Organizations API.
 *
 * GET  /api/organizations  -> organizations the caller belongs to (with counts)
 * POST /api/organizations  -> create an organization; caller becomes owner
 */

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const organizations = await prisma.organization.findMany({
      where: {
        OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
      },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { projects: true, members: true } } },
    })

    return NextResponse.json({
      organizations: organizations.map((o) => ({
        id: o.id,
        slug: o.slug,
        name: o.name,
        plan: o.plan,
        type: o.type,
        projectCount: o._count.projects,
        memberCount: o._count.members,
        isOwner: o.ownerId === user.id,
      })),
    })
  } catch (error) {
    console.error('List organizations error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const name = String(body.name ?? '').trim()
    const type = String(body.type ?? 'Personal')
    const plan = String(body.plan ?? 'Free')

    if (!name) {
      return NextResponse.json({ error: 'Organization name is required' }, { status: 400 })
    }
    if (!['Free', 'Pro', 'Team'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    // Ensure a unique slug even when several orgs share a name.
    const base = slugify(name) || 'org'
    let slug = base
    for (let i = 0; i < 50; i++) {
      const clash = await prisma.organization.findUnique({ where: { slug } })
      if (!clash) break
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
    }

    const organization = await prisma.organization.create({
      data: {
        name,
        slug,
        plan,
        type,
        ownerId: user.id,
        members: { create: [{ userId: user.id, role: 'owner' }] },
      },
    })

    return NextResponse.json({ organization }, { status: 201 })
  } catch (error) {
    console.error('Create organization error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
