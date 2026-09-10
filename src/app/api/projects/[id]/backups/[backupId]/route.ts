import { NextRequest, NextResponse } from 'next/server'
import { requireProjectPermission } from '@/lib/access'
import { deleteBackup, serializeBackup, getBackup } from '@/lib/backup'

interface RouteContext {
  params: Promise<{ id: string; backupId: string }>
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id, backupId } = await params
  try {
    const access = await requireProjectPermission(request, id, 'backup:read')
    if (access.response) return access.response

    const backup = await getBackup(backupId, id)
    if (!backup) {
      return NextResponse.json({ error: 'Backup not found' }, { status: 404 })
    }

    return NextResponse.json({ backup: serializeBackup(backup) })
  } catch (error) {
    console.error('Get backup error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id, backupId } = await params
  try {
    const access = await requireProjectPermission(request, id, 'backup:delete')
    if (access.response) return access.response

    const removed = await deleteBackup(backupId, id)
    if (!removed) {
      return NextResponse.json({ error: 'Backup not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete backup error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
