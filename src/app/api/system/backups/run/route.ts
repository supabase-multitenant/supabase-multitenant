import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/api-auth'
import {
  DEFAULT_RETENTION,
  createDatabaseBackup,
  createStorageBackup,
  pruneBackups,
} from '@/lib/backup'

/**
 * Run scheduled backups for every active project.
 *
 * Called by a host cron (or any scheduler). Two ways in:
 *  - an authenticated panel session (the UI can trigger a run manually), or
 *  - `x-backup-token: $BACKUP_CRON_TOKEN` for unattended callers.
 *
 * A failure on one project must not stop the others, so each is isolated and
 * the outcome is reported per project.
 */
export async function POST(request: NextRequest) {
  try {
    const cronToken = process.env.BACKUP_CRON_TOKEN
    const supplied = request.headers.get('x-backup-token')
    const authorisedByToken = Boolean(cronToken) && supplied === cronToken

    if (!authorisedByToken) {
      const session = await getSession(request)
      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const body = await request.json().catch(() => ({}))
    const includeStorage: boolean = body?.includeStorage === true

    const projects = await prisma.project.findMany({
      where: { status: 'active' },
      select: { id: true, slug: true },
      orderBy: { createdAt: 'asc' },
    })

    const results: Array<{
      slug: string
      ok: boolean
      database?: string
      storage?: string
      pruned?: number
      error?: string
    }> = []

    for (const project of projects) {
      try {
        const database = await createDatabaseBackup(project)
        let storage: string | undefined

        if (includeStorage) {
          const archive = await createStorageBackup(project)
          storage = archive.fileName
        }

        const pruned = await pruneBackups(project.id, DEFAULT_RETENTION)
        results.push({ slug: project.slug, ok: true, database: database.fileName, storage, pruned: pruned.length })
      } catch (error) {
        results.push({
          slug: project.slug,
          ok: false,
          error: error instanceof Error ? error.message : 'unknown error',
        })
      }
    }

    const failed = results.filter((r) => !r.ok)

    return NextResponse.json(
      {
        ran: results.length,
        failed: failed.length,
        retention: DEFAULT_RETENTION,
        results,
      },
      { status: failed.length > 0 ? 207 : 200 }
    )
  } catch (error) {
    console.error('Scheduled backup run error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    hint: 'POST to run backups for all active projects. Auth: panel session, or x-backup-token matching BACKUP_CRON_TOKEN.',
    retention: DEFAULT_RETENTION,
  })
}
