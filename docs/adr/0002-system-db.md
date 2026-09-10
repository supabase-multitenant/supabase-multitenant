# ADR-0002 — System DB topology: `supabase-multitenant-system-main-db`

- **Status:** Proposed (needs owner sign-off — flagged in issue #69)
- **Date:** 2026-09-10
- **Issue:** #69

## Context

On first init, supabase-multitenant must create a **default system database** that manages
the panel's own ADMIN, settings and users — *"a DB of all future DBs"*, containing metadata
about every other database so the panel can render an admin overview.

The panel already has a Postgres control-plane database accessed through Prisma
(`users`, `sessions`, `projects`, `env_vars`, …). The question is how the new
`supabase-multitenant-system-main-db` relates to it.

## Options

**A. The control-plane DB *is* the system DB.**
Rename/brand the existing Prisma database `supabase-multitenant-system-main-db` and add a
`managed_databases` registry table. Nothing new to run.

**B. Provision a *separate* Supabase project** named `supabase-multitenant-system-main-db`
through the panel's own project pipeline (dogfooding), and point the control plane at it.
Most faithful to "it creates a default supabaseDB", but the panel would depend on a stack it
manages (bootstrap ordering, and the panel cannot manage itself if that stack is down).

**C. Control plane stays in the Prisma database; a registry table is *mirrored* into a
provisioned system DB** so the system DB is a real, queryable Supabase for the admin
overview — but the panel's own auth/settings never depend on it being up.

## Decision

**Phase 1 → A.** The Prisma control-plane database is branded
`supabase-multitenant-system-main-db`, gains a `managed_databases` registry, and holds
admin/settings/users. Credentials for it are generated on first init and stored in
`~/.secure-upload/supabase-multitenancy/` (issue #26).

**Phase 2 → C** (after M5) when the admin overview wants live health/size per database.

**B is explicitly rejected**: a panel that cannot start unless a stack it manages is healthy
is a self-hosting foot-gun (this exact class already bit us — the `coolify-db` DNS collision
and the `/data` bind-mount bug).

## Consequences

- No bootstrap ordering hazard; the panel starts with only its own Postgres.
- "System DB" is real for auth/settings/users immediately; "DB of all DBs" arrives with the
  registry (M3) and the live mirror (M5).
- Slight naming nuance to document: the system DB is our control plane, not a managed tenant.

## Acceptance

- Owner confirms A→C.
- M3 implements the registry and first-init credential generation per this ADR.
