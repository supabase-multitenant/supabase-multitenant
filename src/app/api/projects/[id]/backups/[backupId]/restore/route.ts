import { NextRequest, NextResponse } from 'next/server'
import { loadAccessibleProject } from '@/lib/api-auth'
import { getBackup, restoreDatabaseBackup, serializeBackup } from '@/lib/backup'

interface RouteContext {
  params: Promise<{ id: string; backupId: string }>
}

/**
 * Restore a backup into a project.
 *
 * `id` is the project the backup belongs to; the body names the target. They are
 * usually different: restoring into a *fresh* project is the migration path
 * (import a dump exported elsewhere into a new empty project), while restoring
 * into the same project is the disaster-recovery path and requires `overwrite`.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id, backupId } = await params
  try {
    const access = await loadAccessibleProject(request, id)
    if (access.response) return access.response

    const body = await request.json().catch(() => ({}))
    const targetProjectId: string = body?.targetProjectId ?? id
    const overwrite: boolean = body?.overwrite === true

    const backup = await getBackup(backupId, id)
    if (!backup) {
      return NextResponse.json({ error: 'Backup not found' }, { status: 404 })
    }
    if (backup.status !== 'completed') {
      return NextResponse.json(
        { error: `Backup is "${backup.status}" and cannot be restored.` },
        { status: 409 }
      )
    }

    // The caller must also be allowed to touch the target.
    const targetAccess = await loadAccessibleProject(request, targetProjectId)
    if (targetAccess.response) return targetAccess.response

    const result = await restoreDatabaseBackup(
      backupId,
      {
        id: targetAccess.project.id,
        slug: targetAccess.project.slug,
        status: targetAccess.project.status,
      },
      { overwrite }
    )

    const updated = await getBackup(backupId, id)
    return NextResponse.json({
      success: true,
      restore: result,
      ...(updated ? { backup: serializeBackup(updated) } : {}),
    })
  } catch (error) {
    console.error('Restore backup error:', error)
    const message = error instanceof Error ? error.message : 'Restore failed'
    // A guard rejection is the caller's problem, not a server fault.
    const status = /must be "active"|already has|Only database backups/.test(message) ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
