import { NextRequest, NextResponse } from 'next/server'
import { requireProjectPermission } from '@/lib/access'
import {
  BACKUP_KINDS,
  DEFAULT_RETENTION,
  createDatabaseBackup,
  createStorageBackup,
  listBackups,
  pruneBackups,
  backupFootprint,
  type BackupKind,
} from '@/lib/backup'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const access = await requireProjectPermission(request, id, 'backup:read')
    if (access.response) return access.response

    const [backups, footprint] = await Promise.all([
      listBackups(id),
      backupFootprint(id),
    ])

    return NextResponse.json({ backups, footprintBytes: footprint })
  } catch (error) {
    console.error('List backups error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const access = await requireProjectPermission(request, id, 'backup:create')
    if (access.response) return access.response

    const body = await request.json().catch(() => ({}))
    const kind: BackupKind = body?.kind ?? 'database'

    if (!BACKUP_KINDS.includes(kind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${BACKUP_KINDS.join(', ')}` },
        { status: 400 }
      )
    }

    const project = { id: access.project.id, slug: access.project.slug }

    const created =
      kind === 'database'
        ? await createDatabaseBackup(project, { schemas: body?.schemas })
        : await createStorageBackup(project)

    // Apply retention immediately so a schedule can't grow without bound.
    const pruned = await pruneBackups(id, DEFAULT_RETENTION)

    return NextResponse.json({
      backup: created,
      pruned: pruned.length,
      retention: DEFAULT_RETENTION,
    })
  } catch (error) {
    console.error('Create backup error:', error)
    const message = error instanceof Error ? error.message : 'Backup failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
