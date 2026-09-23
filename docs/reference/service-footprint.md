# Service footprint and the shared-plane boundary

> Reference for [ADR-0003](../adr/0003-shared-infrastructure-plane.md). Measured on `z370n`
> 2026-09-23 against `project101-of-org202` (one **idle** stack, all 11 containers healthy).

## Measured footprint — one idle project

| Service | RAM (idle) | CPU | Binds one tenant DB? | Plane |
|---|---:|---:|---|---|
| `studio` | 278.9 MiB | 0.00% | no — `STUDIO_PG_META_URL` + `api-gw` | **shared** |
| `realtime` | 257.6 MiB | 0.14% | **yes** — WAL / replication slots | per project |
| `supavisor` | 253.9 MiB | 10.62% | **no** — binds `/_supabase`, its own metadata DB | **shared** |
| `storage` | 180.2 MiB | 0.02% | **yes** — `DATABASE_URL` | per project |
| `db` | 152.4 MiB | 2.76% | **yes** — the tenant's data | per project |
| `meta` | 111.9 MiB | 0.38% | yes by default config; multi-DB capable | **shared** (phase 2) |
| `functions` | 103.5 MiB | 0.01% | **yes** — `SUPABASE_DB_URL` | per project |
| `imgproxy` | 93.8 MiB | 4.68% | no — stateless | **shared** |
| `api-gw` | 93.8 MiB | 0.88% | no — pure router | **shared** |
| `rest` | 51.1 MiB | 0.11% | **yes** — `PGRST_DB_URI` | per project |
| `auth` | 39.7 MiB | 2.07% | **yes** — `GOTRUE_DB_DATABASE_URL` | per project |
| **total** | **1,616.8 MiB** | | **11 containers** | |

**Infrastructure copied again per project: 832.3 MiB — 51% of the stack.**
(`studio` + `supavisor` + `imgproxy` + `api-gw` + `meta`.)

## Idle cost at scale, inherited model

| Projects | RAM | Containers |
|---:|---:|---:|
| 1 | 1.6 GiB | 11 |
| 5 | 7.9 GiB | 55 |
| 10 | 15.8 GiB | 110 |
| 25 | 39.5 GiB | 275 |
| 50 | 78.9 GiB | 550 |

## Target

| Configuration | RAM (idle) | Containers |
|---|---:|---:|
| Inherited model | 1,616.8 MiB | 11 |
| Shared plane hoisted | ~896 MiB | 6 |
| DB + Auth only (data-plane on demand) | **~192 MiB** | 2 |

## Why the per-project list cannot be shortened further

`auth`, `rest`, `realtime`, `storage` and `functions` are each configured with **one** connection
string and have no tenant selector, so a single instance cannot serve tenants that live in
*separate* Postgres instances. This is a property of the services, not a design choice — Supabase
Cloud carries the same constraint and also runs them per project.

Two ways to "share" them exist, and both are rejected:

- **One Postgres with per-tenant schemas** — rejected by the owner. It trades away per-tenant
  database isolation, which is the product.
- **Forking the services** to add a tenant selector — a maintenance burden far larger than the
  saving, and it diverges from upstream in the one place where a subtle bug means a cross-tenant
  data leak.

What *is* available on the per-project side is **not running them at all** until the project uses
that capability (Phase 4).

## The mechanism to verify on every change

```ts
import { findSharedPlaneServices } from '@/lib/shared-plane'

// must be empty for any generated project compose
findSharedPlaneServices(projectCompose)
```

Verified against the real 589-line generated stack: it reports all five shared services today
(the regression it exists to catch) and zero after `splitProjectCompose()`.
`tests/shared-plane.test.ts` keeps it honest.
