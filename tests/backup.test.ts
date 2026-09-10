import { describe, expect, it, vi } from 'vitest'

// The pure helpers below need no database; stub Prisma so the import is hermetic.
vi.mock('@/lib/db', () => ({ prisma: {} }))

import {
  backupDirectory,
  backupExtension,
  backupFileName,
  backupStamp,
  dbContainerName,
  parseBackupFileName,
  selectBackupsToPrune,
  serializeBackup,
  validateRestoreTarget,
  DEFAULT_RETENTION,
  DEFAULT_SCHEMAS,
  PLATFORM_SCHEMAS,
} from '@/lib/backup'

const SLUG = 'playgroundsb1-1788963289601'

describe('naming', () => {
  it('stamps a date in a filesystem- and sort-safe form', () => {
    expect(backupStamp(new Date('2026-09-10T16:20:30.123Z'))).toBe('20260910T162030Z')
  })

  it('puts the slug first so backups group by project', () => {
    const name = backupFileName(SLUG, 'database', new Date('2026-09-10T16:20:30Z'))
    expect(name).toBe(`${SLUG}_database_20260910T162030Z.dump`)
    expect(name.startsWith(SLUG)).toBe(true)
  })

  it('uses an archive extension for storage, a dump extension for the db', () => {
    expect(backupExtension('database')).toBe('dump')
    expect(backupExtension('storage')).toBe('tar.gz')
  })

  it('round-trips both kinds', () => {
    for (const kind of ['database', 'storage'] as const) {
      const name = backupFileName(SLUG, kind, new Date('2026-09-10T16:20:30Z'))
      expect(parseBackupFileName(name)).toEqual({
        slug: SLUG,
        kind,
        stamp: '20260910T162030Z',
      })
    }
  })

  it('rejects names that are not ours', () => {
    expect(parseBackupFileName('random.txt')).toBeNull()
    expect(parseBackupFileName(`${SLUG}_database_notastamp.dump`)).toBeNull()
    expect(parseBackupFileName(`${SLUG}_unknown_20260910T162030Z.dump`)).toBeNull()
  })

  it('keeps slugs with hyphens intact', () => {
    const other = 'proj-a-12-345'
    expect(parseBackupFileName(backupFileName(other, 'database', new Date()))?.slug).toBe(other)
  })

  it('builds the per-project directory', () => {
    expect(backupDirectory(SLUG, '/data/backups')).toBe(`/data/backups/${SLUG}`)
  })

  it('names the db container from the slug', () => {
    expect(dbContainerName(SLUG)).toBe(`${SLUG}-db`)
  })
})

describe('schema defaults', () => {
  it('dumps only the application schema by default', () => {
    expect(DEFAULT_SCHEMAS).toEqual(['public'])
  })

  it('does not dump platform-managed schemas into a fresh project by default', () => {
    for (const schema of ['auth', 'storage', 'realtime']) {
      expect(DEFAULT_SCHEMAS).not.toContain(schema)
      expect(PLATFORM_SCHEMAS).toContain(schema)
    }
  })
})

describe('selectBackupsToPrune', () => {
  const at = (daysAgo: number, kind = 'database', id = `b${daysAgo}`) => ({
    id: `${id}-${kind}`,
    kind,
    createdAt: new Date(Date.UTC(2026, 8, 10) - daysAgo * 24 * 60 * 60 * 1000),
  })
  const NOW = new Date(Date.UTC(2026, 8, 10))

  it('keeps the N most recent and prunes the rest', () => {
    const backups = [at(1), at(2), at(3), at(4), at(5)]
    const doomed = selectBackupsToPrune(backups, { keep: 2 }, NOW)
    expect(doomed).toHaveLength(3)
    // the two newest survive; the three oldest are doomed
    expect(doomed.map((b) => b.id).sort()).toEqual([at(3).id, at(4).id, at(5).id].sort())
  })

  it('keeps everything when under the limit', () => {
    expect(selectBackupsToPrune([at(1), at(2)], { keep: 7 }, NOW)).toEqual([])
  })

  it('does not assume the input is sorted', () => {
    const shuffled = [at(5), at(1), at(3), at(2), at(4)]
    const doomed = selectBackupsToPrune(shuffled, { keep: 2 }, NOW)
    // the two newest (1,2 days ago) must survive
    const survivors = [at(1).id, at(2).id]
    for (const s of survivors) {
      expect(doomed.map((b) => b.id)).not.toContain(s)
    }
    expect(doomed).toHaveLength(3)
  })

  it('counts retention per kind, not across kinds', () => {
    const backups = [at(1, 'database'), at(2, 'database'), at(1, 'storage'), at(2, 'storage')]
    // keep 1 of each -> exactly one database and one storage pruned
    const doomed = selectBackupsToPrune(backups, { keep: 1 }, NOW)
    expect(doomed).toHaveLength(2)
    expect(new Set(doomed.map((b) => b.kind))).toEqual(new Set(['database', 'storage']))
  })

  it('prunes by age even when within the keep count', () => {
    const backups = [at(1), at(40)]
    const doomed = selectBackupsToPrune(backups, { keep: 10, maxAgeDays: 30 }, NOW)
    expect(doomed).toHaveLength(1)
    expect(doomed[0].id).toBe(at(40).id)
  })

  it('keeps recent backups even when beyond the keep count, if no age rule is set', () => {
    const backups = [at(1), at(2), at(3)]
    // keep 10 -> nothing pruned regardless of age
    expect(selectBackupsToPrune(backups, { keep: 10 }, NOW)).toEqual([])
  })

  it('handles an empty list and a keep of zero', () => {
    expect(selectBackupsToPrune([], { keep: 3 }, NOW)).toEqual([])
    expect(selectBackupsToPrune([at(1)], { keep: 0 }, NOW)).toHaveLength(1)
  })

  it('has a sane default policy', () => {
    expect(DEFAULT_RETENTION.keep).toBeGreaterThan(0)
  })
})

describe('serializeBackup', () => {
  const base = {
    id: 'b1',
    projectId: 'p1',
    kind: 'database',
    status: 'completed',
    fileName: 'x.dump',
    sha256: 'abc',
    error: null,
    restoreCount: 2,
    lastRestoredAt: null,
    createdAt: new Date('2026-09-10T16:00:00Z'),
    completedAt: new Date('2026-09-10T16:01:00Z'),
  }

  it('turns a BigInt size into a JSON-safe number', () => {
    const json = serializeBackup({ ...base, sizeBytes: BigInt(123456) })
    expect(json.sizeBytes).toBe(123456)
    expect(() => JSON.stringify(json)).not.toThrow()
  })

  it('keeps very large sizes as strings, to avoid precision loss', () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(10)
    const json = serializeBackup({ ...base, sizeBytes: huge })
    expect(typeof json.sizeBytes).toBe('string')
    expect(json.sizeBytes).toBe(huge.toString())
  })

  it('passes null through and ISO-formats dates', () => {
    const json = serializeBackup({ ...base, sizeBytes: null })
    expect(json.sizeBytes).toBeNull()
    expect(json.createdAt).toBe('2026-09-10T16:00:00.000Z')
    expect(json.completedAt).toBe('2026-09-10T16:01:00.000Z')
    expect(json.lastRestoredAt).toBeNull()
  })
})

describe('validateRestoreTarget', () => {
  const ok = { backupKind: 'database', targetStatus: 'active', targetPublicTableCount: 0, overwrite: false }

  it('allows a fresh, empty, active target', () => {
    expect(() => validateRestoreTarget(ok)).not.toThrow()
  })

  it('refuses to overwrite live data unless asked', () => {
    expect(() => validateRestoreTarget({ ...ok, targetPublicTableCount: 5 })).toThrow(
      /already has 5 table/
    )
    expect(() =>
      validateRestoreTarget({ ...ok, targetPublicTableCount: 5, overwrite: true })
    ).not.toThrow()
  })

  it('refuses a target that is not active', () => {
    for (const status of ['paused', 'stopped', 'error']) {
      expect(() => validateRestoreTarget({ ...ok, targetStatus: status })).toThrow(/must be "active"/)
    }
  })

  it('refuses a storage backup for a database restore', () => {
    expect(() => validateRestoreTarget({ ...ok, backupKind: 'storage' })).toThrow(
      /Only database backups/
    )
  })
})
