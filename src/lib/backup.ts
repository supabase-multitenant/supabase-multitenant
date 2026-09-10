import { promises as fs, createWriteStream, createReadStream } from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { prisma } from './db'
import { getBackupsBasePath } from './paths'

/**
 * Per-project backup and restore.
 *
 * This is the durability story for self-hosted stacks *and* the engine the
 * cloud -> self-hosted migration rides on: "restore a dump into a project" is
 * the same operation whether the dump came from a previous backup of this
 * project or from Supabase Cloud (#99).
 *
 * Backups are written outside `projects/` so they survive a project being
 * deleted or re-provisioned (see getBackupsBasePath).
 */

export const BACKUP_KINDS = ['database', 'storage'] as const
export type BackupKind = (typeof BACKUP_KINDS)[number]

/** Schemas dumped by default: application data only. */
export const DEFAULT_SCHEMAS = ['public']

/**
 * Platform-managed schemas. Dumping these into a *fresh* project would clash
 * with the roles/objects its own init scripts create, so they are opt-in.
 */
export const PLATFORM_SCHEMAS = ['auth', 'storage', 'realtime', 'supabase_migrations', 'vault']

export interface RetentionPolicy {
  /** How many backups of a kind to keep regardless of age. */
  keep: number
  /** Optionally also drop anything older than this many days. */
  maxAgeDays?: number
}

export const DEFAULT_RETENTION: RetentionPolicy = { keep: 7 }

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/** `2026-09-10T16:20:30.123Z` -> `20260910T162030Z` (filesystem + sort safe). */
export function backupStamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

export function backupExtension(kind: BackupKind): string {
  return kind === 'database' ? 'dump' : 'tar.gz'
}

/** `<slug>_<kind>_<stamp>.<ext>` — slug first so `ls` groups by project. */
export function backupFileName(slug: string, kind: BackupKind, at: Date): string {
  return `${slug}_${kind}_${backupStamp(at)}.${backupExtension(kind)}`
}

export interface ParsedBackupName {
  slug: string
  kind: BackupKind
  stamp: string
}

export function parseBackupFileName(fileName: string): ParsedBackupName | null {
  const match = fileName.match(/^(.+)_(database|storage)_(\d{8}T\d{6}Z)\.(?:dump|tar\.gz)$/)
  if (!match) return null
  return { slug: match[1], kind: match[2] as BackupKind, stamp: match[3] }
}

/** Absolute directory holding one project's backup artifacts. */
export function backupDirectory(slug: string, base = getBackupsBasePath()): string {
  return path.join(base, slug)
}

/**
 * Which backups a retention policy says to delete.
 *
 * Two independent rules, either of which prunes a backup:
 *  - `keep`: the N most recent per kind are always retained;
 *  - `maxAgeDays` (optional): nothing older than this survives.
 *
 * Input order is not assumed — ordering happens here so callers can pass
 * whatever the database returned.
 */
export function selectBackupsToPrune<
  T extends { id: string; kind: string; createdAt: Date },
>(backups: T[], policy: RetentionPolicy, now: Date = new Date()): T[] {
  const doomed: T[] = []
  const cutoff =
    policy.maxAgeDays === undefined
      ? null
      : new Date(now.getTime() - policy.maxAgeDays * 24 * 60 * 60 * 1000)

  const byKind = new Map<string, T[]>()
  for (const backup of backups) {
    const list = byKind.get(backup.kind) ?? []
    list.push(backup)
    byKind.set(backup.kind, list)
  }

  for (const list of byKind.values()) {
    const sorted = [...list].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )
    sorted.forEach((backup, index) => {
      const beyondKeep = index >= policy.keep
      const beyondAge = cutoff !== null && backup.createdAt < cutoff
      if (beyondKeep || beyondAge) {
        doomed.push(backup)
      }
    })
  }

  return doomed
}

export interface BackupJson {
  id: string
  projectId: string
  kind: string
  status: string
  fileName: string
  sizeBytes: number | string | null
  sha256: string | null
  error: string | null
  restoreCount: number
  lastRestoredAt: string | null
  createdAt: string
  completedAt: string | null
}

/** Prisma returns BigInt for sizeBytes, which JSON.stringify refuses. */
export function serializeBackup(row: {
  id: string
  projectId: string
  kind: string
  status: string
  fileName: string
  sizeBytes: bigint | null
  sha256: string | null
  error: string | null
  restoreCount: number
  lastRestoredAt: Date | null
  createdAt: Date
  completedAt: Date | null
}): BackupJson {
  let size: number | string | null = null
  if (row.sizeBytes !== null) {
    size =
      row.sizeBytes <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(row.sizeBytes)
        : row.sizeBytes.toString()
  }
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    status: row.status,
    fileName: row.fileName,
    sizeBytes: size,
    sha256: row.sha256,
    error: row.error,
    restoreCount: row.restoreCount,
    lastRestoredAt: row.lastRestoredAt ? row.lastRestoredAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  }
}

/**
 * Guard for restoring a backup into a target project.
 *
 * Restoring over live data is destructive, so it must be asked for explicitly;
 * the common migration path is a *fresh, empty* project.
 */
export function validateRestoreTarget(opts: {
  backupKind: string
  targetStatus: string
  targetPublicTableCount: number
  overwrite: boolean
}): void {
  const { backupKind, targetStatus, targetPublicTableCount, overwrite } = opts

  if (backupKind !== 'database') {
    throw new Error(
      `Only database backups can be restored into a project (got kind "${backupKind}").`
    )
  }
  if (targetStatus !== 'active') {
    throw new Error(
      `Target project must be "active" to restore into it (status is "${targetStatus}").`
    )
  }
  if (targetPublicTableCount > 0 && !overwrite) {
    throw new Error(
      `Target project already has ${targetPublicTableCount} table(s) in the public schema. ` +
        `Pass overwrite=true to replace its contents deliberately.`
    )
  }
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

interface RunResult {
  code: number
  stderr: string
}

/** Run a command, streaming stdout into a file (binary-safe). */
function pipeToFile(command: string, args: string[], filePath: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(filePath)
    let stderr = ''
    const child = spawn(command, args)

    child.stdout.pipe(out)
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      out.destroy()
      reject(error)
    })
    out.on('error', (error) => {
      child.kill()
      reject(error)
    })
    child.on('close', (code) => {
      out.end(() => resolve({ code: code ?? 0, stderr }))
    })
  })
}

/** Run a command feeding a file into its stdin (binary-safe). */
function pipeFromFile(command: string, args: string[], filePath: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const child = spawn(command, args)
    const input = createReadStream(filePath)

    input.pipe(child.stdin)
    input.on('error', reject)
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 0, stderr }))
  })
}

/** Run a command and collect its stdout. */
function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c.toString()))
    child.stderr.on('data', (c) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
  })
}

export function dbContainerName(slug: string): string {
  return `${slug}-db`
}

/** Names of tables the application itself owns in a project's public schema. */
export async function publicTableCount(slug: string): Promise<number> {
  const { code, stdout } = await run('docker', [
    'exec',
    dbContainerName(slug),
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-tAc',
    "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
  ])
  if (code !== 0) throw new Error(`Could not inspect ${slug}: psql exit ${code}`)
  return Number(stdout.trim() || '0')
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const data = await fs.readFile(filePath)
  hash.update(data)
  return hash.digest('hex')
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/**
 * `pg_dump` a project's database into `backups/<slug>/`.
 *
 * Defaults to the application schema only. Pass `schemas` explicitly (e.g. to
 * include `auth` for a full platform migration) when you know the target
 * expects those objects.
 */
export async function createDatabaseBackup(
  project: { id: string; slug: string },
  options: { schemas?: string[] } = {}
): Promise<{ id: string; fileName: string; sizeBytes: number; sha256: string }> {
  const schemas = options.schemas ?? DEFAULT_SCHEMAS
  const at = new Date()
  const fileName = backupFileName(project.slug, 'database', at)
  const dir = backupDirectory(project.slug)
  const filePath = path.join(dir, fileName)

  await fs.mkdir(dir, { recursive: true })

  const row = await prisma.projectBackup.create({
    data: {
      projectId: project.id,
      kind: 'database',
      status: 'running',
      fileName,
      filePath,
    },
  })

  const args = [
    'exec',
    '-i',
    dbContainerName(project.slug),
    'pg_dump',
    '-Fc',
    '--no-owner',
    '--no-acl',
    '-U',
    'postgres',
    '-d',
    'postgres',
  ]
  for (const schema of schemas) {
    args.push(`--schema=${schema}`)
  }

  const { code, stderr } = await pipeToFile('docker', args, filePath)

  if (code !== 0) {
    await fs.rm(filePath, { force: true })
    await prisma.projectBackup.update({
      where: { id: row.id },
      data: { status: 'failed', error: stderr.slice(-2000) || `pg_dump exit ${code}` },
    })
    throw new Error(`pg_dump failed for ${project.slug}: ${stderr.slice(-400)}`)
  }

  const stat = await fs.stat(filePath)
  if (stat.size === 0) {
    await fs.rm(filePath, { force: true })
    await prisma.projectBackup.update({
      where: { id: row.id },
      data: { status: 'failed', error: 'pg_dump produced an empty file' },
    })
    throw new Error(`pg_dump produced an empty dump for ${project.slug}`)
  }

  const sha256 = await sha256File(filePath)
  await prisma.projectBackup.update({
    where: { id: row.id },
    data: { status: 'completed', sizeBytes: BigInt(stat.size), sha256, completedAt: new Date() },
  })

  return { id: row.id, fileName, sizeBytes: stat.size, sha256 }
}

/**
 * Archive a project's storage volume (bucket objects) into `backups/<slug>/`.
 *
 * The storage volume is a host path bind-mounted into the storage container, so
 * it is archived directly — no exec into a container and no named volume needed.
 */
export async function createStorageBackup(project: {
  id: string
  slug: string
}): Promise<{ id: string; fileName: string; sizeBytes: number; sha256: string }> {
  const at = new Date()
  const fileName = backupFileName(project.slug, 'storage', at)
  const dir = backupDirectory(project.slug)
  const filePath = path.join(dir, fileName)
  const volumePath = path.join(
    getBackupsBasePath(),
    '..',
    'projects',
    project.slug,
    'docker',
    'volumes',
    'storage'
  )

  await fs.mkdir(dir, { recursive: true })

  const row = await prisma.projectBackup.create({
    data: {
      projectId: project.id,
      kind: 'storage',
      status: 'running',
      fileName,
      filePath,
    },
  })

  if (!(await fs.stat(volumePath).catch(() => null))) {
    await prisma.projectBackup.update({
      where: { id: row.id },
      data: { status: 'failed', error: `storage volume not found at ${volumePath}` },
    })
    throw new Error(`Storage volume not found for ${project.slug}: ${volumePath}`)
  }

  const { code, stderr } = await run('tar', ['czf', filePath, '-C', volumePath, '.'])

  if (code !== 0) {
    await fs.rm(filePath, { force: true })
    await prisma.projectBackup.update({
      where: { id: row.id },
      data: { status: 'failed', error: stderr.slice(-2000) || `tar exit ${code}` },
    })
    throw new Error(`tar failed for ${project.slug}: ${stderr.slice(-400)}`)
  }

  const stat = await fs.stat(filePath)
  const sha256 = await sha256File(filePath)
  await prisma.projectBackup.update({
    where: { id: row.id },
    data: { status: 'completed', sizeBytes: BigInt(stat.size), sha256, completedAt: new Date() },
  })

  return { id: row.id, fileName, sizeBytes: stat.size, sha256 }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Restore a database backup into a project.
 *
 * This is the migration primitive: the same call restores a freshly taken
 * backup or a dump exported from Supabase Cloud.
 */
export async function restoreDatabaseBackup(
  backupId: string,
  target: { id: string; slug: string; status: string },
  options: { overwrite?: boolean } = {}
): Promise<{ restoredFrom: string; target: string; tables: number }> {
  const backup = await prisma.projectBackup.findUnique({ where: { id: backupId } })
  if (!backup) throw new Error(`Backup ${backupId} not found`)

  const tableCount = await publicTableCount(target.slug)
  validateRestoreTarget({
    backupKind: backup.kind,
    targetStatus: target.status,
    targetPublicTableCount: tableCount,
    overwrite: options.overwrite ?? false,
  })

  const args = [
    'exec',
    '-i',
    dbContainerName(target.slug),
    'pg_restore',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--no-owner',
    '--no-acl',
    '--clean',
    '--if-exists',
    '--single-transaction',
  ]

  const { code, stderr } = await pipeFromFile('docker', args, backup.filePath)
  if (code !== 0) {
    throw new Error(`pg_restore failed for ${target.slug}: ${stderr.slice(-600)}`)
  }

  await prisma.projectBackup.update({
    where: { id: backup.id },
    data: { restoreCount: { increment: 1 }, lastRestoredAt: new Date() },
  })

  return {
    restoredFrom: backup.fileName,
    target: target.slug,
    tables: await publicTableCount(target.slug),
  }
}

// ---------------------------------------------------------------------------
// Listing + retention
// ---------------------------------------------------------------------------

export async function listBackups(projectId: string): Promise<BackupJson[]> {
  const rows = await prisma.projectBackup.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(serializeBackup)
}

/** Delete artifacts beyond the retention policy. Returns what was removed. */
export async function pruneBackups(
  projectId: string,
  policy: RetentionPolicy = DEFAULT_RETENTION
): Promise<string[]> {
  const rows = await prisma.projectBackup.findMany({
    where: { projectId, status: 'completed' },
    orderBy: { createdAt: 'desc' },
  })

  const filePaths = new Map(rows.map((r) => [r.id, r.filePath]))
  const doomed = selectBackupsToPrune(
    rows.map((r) => ({ id: r.id, kind: r.kind, createdAt: r.createdAt })),
    policy
  )

  for (const backup of doomed) {
    const filePath = filePaths.get(backup.id)
    if (filePath) await fs.rm(filePath, { force: true })
    await prisma.projectBackup.delete({ where: { id: backup.id } })
  }

  return doomed.map((b) => b.id)
}

/** Best-effort size of everything stored for a project, in bytes. */
export async function backupFootprint(projectId: string): Promise<number> {
  const rows = await prisma.projectBackup.findMany({
    where: { projectId },
    select: { sizeBytes: true },
  })
  return rows.reduce((total, row) => total + Number(row.sizeBytes ?? 0), 0)
}

/** Load a single backup, scoped to the project it belongs to. */
export async function getBackup(backupId: string, projectId: string) {
  return prisma.projectBackup.findFirst({ where: { id: backupId, projectId } })
}

/** Remove a backup artifact and its record. Returns false if it wasn't there. */
export async function deleteBackup(backupId: string, projectId: string): Promise<boolean> {
  const row = await prisma.projectBackup.findFirst({
    where: { id: backupId, projectId },
  })
  if (!row) return false

  await fs.rm(row.filePath, { force: true })
  await prisma.projectBackup.delete({ where: { id: row.id } })
  return true
}
