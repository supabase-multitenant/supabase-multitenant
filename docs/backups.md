# Project backups, restore and retention

Self-hosting means owning the durability story. These are the primitives that make a
self-hosted stack safe to put real data in — and that the cloud → self-hosted migration
rides on.

## What is backed up

| Kind | Mechanism | Artifact |
| --- | --- | --- |
| `database` | `pg_dump -Fc` streamed out of the project's `<slug>-db` container | `<slug>_database_<stamp>.dump` |
| `storage` | `tar czf` of the project's storage volume | `<slug>_storage_<stamp>.tar.gz` |

Artifacts live in `<DATA_PATH>/backups/<slug>/` — deliberately **outside** `projects/`, so a
backup survives its project being deleted or re-provisioned. That is also what lets a dump be
restored into a *new* project.

Every artifact records its size and a sha256 in the panel database (`project_backups`).

### Dump scope

The default scope is the **application schema only** (`public`). Platform-managed schemas
(`auth`, `storage`, `realtime`, …) are opt-in via the `schemas` option, because dumping them
into a fresh project clashes with the roles and objects that project's own init scripts
create. For a full platform move, request them explicitly — see #92 (auth migration).

## Retention

Default policy: **keep the 7 most recent backups per kind**.

```ts
DEFAULT_RETENTION = { keep: 7 }            // optionally add maxAgeDays
```

Two rules, either of which prunes: the oldest beyond `keep` are removed, and (if
`maxAgeDays` is set) nothing older than that survives. Retention is applied immediately after
every backup, so a schedule cannot grow without bound.

## Taking a backup

```bash
# the caller must be able to access the project (owner, or org owner/member)
curl -b cookies.txt -X POST \
  https://<panel>/api/projects/<projectId>/backups \
  -H 'Content-Type: application/json' \
  -d '{"kind":"database"}'
```

`kind` is `database` or `storage`. Responses include the file name, size and sha256, plus how
many old backups retention pruned.

Other endpoints:

| Method + path | Purpose |
| --- | --- |
| `GET /api/projects/<id>/backups` | list backups + total footprint |
| `GET /api/projects/<id>/backups/<backupId>` | one backup |
| `DELETE /api/projects/<id>/backups/<backupId>` | remove artifact + record |
| `POST /api/projects/<id>/backups/<backupId>/restore` | restore (see below) |
| `POST /api/system/backups/run` | back up **all** active projects (cron entry point) |

## Restoring

```bash
# restore into a DIFFERENT (fresh) project — the migration path
curl -b cookies.txt -X POST \
  https://<panel>/api/projects/<sourceProjectId>/backups/<backupId>/restore \
  -H 'Content-Type: application/json' \
  -d '{"targetProjectId":"<freshProjectId>"}'
```

Guards (a rejected guard is a `409`, not a server error):

- the backup must be `completed`;
- the target project must be `active`;
- restoring over a target that already has tables in `public` requires `"overwrite": true`;
- a `storage` archive cannot be restored as a database.

Pass `"targetProjectId"` omitted to restore a project **into itself** (disaster recovery);
that needs `overwrite` once the project has data.

## Scheduling

`POST /api/system/backups/run` backs up every `active` project and applies retention. It
accepts either an authenticated panel session or a shared token for unattended callers:

```bash
# on the host, e.g. /etc/cron.d/supabase-multitenant-backups
0 3 * * *  curl -fsS -X POST -H "x-backup-token: $BACKUP_CRON_TOKEN" \
             https://<panel>/api/system/backups/run \
             -H 'Content-Type: application/json' -d '{"includeStorage":true}'
```

Set `BACKUP_CRON_TOKEN` in the panel's environment. Both the token and `includeStorage` are
opt-in — with neither set the endpoint requires a session and backs up databases only.

Failures are isolated per project: one broken project cannot stop the others, and the
response lists the outcome for each (`207` when any failed).

## Restore drill — executed 2026-09-10

Per the ticket, the restore was not assumed but **executed once end to end**, against a
running deployment.

| Step | Result |
| --- | --- |
| Seed the source database | `drill_items`, 250 rows, index, jsonb payload — fingerprint `edf23aa1a1f55c1229550fa3f644e26c` |
| Back up via the API | `playgroundsb1-1788963289601_database_20260910T144247Z.dump`, 6 037 bytes, sha256 recorded |
| Provision a **fresh** project | `drill-restore-164259-1789051379623` — 11 containers, all healthy, all slug-namespaced |
| Confirm the target is empty | `public` tables: **0** |
| Restore via the API | HTTP 200, `tables now: 1`, `restoreCount` incremented, `lastRestoredAt` stamped |
| Verify the data | target fingerprint `edf23aa1a1f55c1229550fa3f644e26c` — **identical**; 250 rows |
| Verify schema objects | `drill_items_label_idx` present |
| Verify sequence state | next insert returned id **251** (not 1) — sequence values survived the restore |

The same run proved two projects can run side by side, which is the precondition for the
migration dry run (#99).

Storage was verified separately: an object placed in the source volume
(`drill-bucket/probe.txt` → `hello-from-drill`) came back out of the archive
`playgroundsb1-…_storage_…tar.gz` byte-identical.

## Not covered yet

- **Point-in-time recovery (WAL archiving)** — the ticket's original phrasing mentioned
  `wal-g`. What is implemented today is scheduled **logical** dumps with retention. Logical
  dumps give restore-to-a-point-in-the-past only at backup granularity; sub-second PITR needs
  continuous WAL archiving, which is a separate piece of work.
- **Off-host copies** — backups currently live on the same machine as the stack.
- **Encryption at rest** for backup artifacts.
- **Restoring a `storage` archive** back into a project (only backup is implemented so far).
