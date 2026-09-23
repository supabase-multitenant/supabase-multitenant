# Shared infrastructure plane — implementation plan

> **Implements:** [ADR-0003](../adr/0003-shared-infrastructure-plane.md)
> **Principle:** the platform is stood up **once**. A new project adds a database and the services
> that cannot multiplex — nothing else is copied.

## Why this is not a refactor

The inherited model (`createProject` → copy `supabase-core/docker` → rewrite → `docker compose up`)
produces a **complete stack per project**. Meeting the product's stated purpose means changing
*what a project is*: today it is "a copy of the platform"; it must become "a database plus the thin
services bound to it, registered in the shared plane".

## Target layout

```
/data/shared/                      ← stood up once, owned by the panel
  gateway/        api-gw (envoy)    per-tenant routing, TLS, one public entrypoint
  pooler/         supavisor         multiplexes every tenant DB (own _supabase metadata DB)
  imgproxy/       imgproxy          stateless
  studio/         studio            ONE dashboard, all projects
  meta/           postgres-meta     phase 2

/data/projects/<slug>/             ← per project, generated NOT copied
  gateway/<slug>.yaml              routes for this tenant, consumed by the shared gateway
  docker/docker-compose.yml        db + auth + rest [+ realtime, storage, functions on demand]
  docker/.env                      this project's creds/ports
```

## Phases

### Phase 0 — Honest baseline (no behaviour change)
- Machine-readable inventory of what each generated service costs in RAM and whether it binds one
  tenant DB. Record in `docs/reference/service-footprint.md`.
- A test that asserts the generated per-project compose contains **no** service from the shared
  set — the invariant that stops the old model creeping back.

**Done when:** the invariant test fails against today's generated compose (proving it catches the
regression), and passes once the split lands.

### Phase 1 — Hoist the gateway
- Extract `api-gw` from the per-project compose into the shared plane.
- Generate `gateway/<slug>.yaml` per project from the panel, mapping the tenant's public host to
  `auth`, `rest`, `realtime`, `storage` in that tenant's network. The panel writes the file; the
  shared gateway picks it up.
- The tenant network must be reachable by the shared gateway — the same private-bridge pattern
  already used for Studio, not a re-introduction of public ports.

**Done when:** two projects are reachable through the single gateway on their own hosts, and
removing one project's route file 404s only that project.

### Phase 2 — Hoist the pooler and imgproxy
- One Supavisor serving all tenants. Register each tenant DB in its metadata at project-create.
- One imgproxy; storage points at it.
- Delete both from the per-project compose.

**Done when:** `select`ing through the shared pooler reaches two different tenant databases with
different credentials, and cross-tenant access is refused.

### Phase 3 — One Studio for all projects
- Single Studio in the shared plane bound to the shared `meta`.
- Each project appears as a project in the dashboard; opening one must not expose another.
- This is the capability Supabase keeps closed and where `supabase-studio-multi-head` is the
  reference — study its approach for studying only, per `docs/reference/makerkit-notes.md`
  discipline. **No third-party code enters this repo.**

**Done when:** a signed-in panel user with access to one project cannot enumerate or open another
through Studio, verified by request, not by reading the UI.

### Phase 4 — Provision only what is used
- Per-project capability flags (`realtime`, `storage`, `functions`).
- Create a project → `db` + `auth` + `rest` only (~192 MiB, 2–3 containers).
- Enabling a capability later provisions that service into the tenant's compose and starts it.

**Done when:** a freshly created project runs 2–3 containers; enabling realtime adds exactly one.

### Phase 5 — Single points of failure
- Health checks, restart policy and a documented blast radius for gateway, pooler, Studio.
- A tenant-isolation test suite that runs against the **shared** components: routing, pooler
  credentials, Studio project enumeration. This is the test that matters — isolation is now
  maintained, not structural.

### Phase 6 — Migrate the existing projects
- `playgroundSB1`, `drill-restore-164259`, `supabaseMultitenantDemo1`, `project101_of_org202`
  currently run the old 11-container layout.
- Per project: register in the shared plane, prune the shared services from its compose, move its
  routes to the gateway, recreate. Rehearse on `drill-restore-164259` first — it exists for this.
- Do not leave the estate mixed: the old and new layouts must not both be considered supported.

## Sequencing rule

Phases 1→2 deliver most of the saving with the least isolation risk, and each is independently
reversible. **Phase 3 is the one that needs the most care** — a multi-project dashboard is a
cross-tenant surface by definition. Do not start Phase 4 or 6 until 1 and 2 are verified on real
projects.

## Verification per phase

- The invariant test from Phase 0 stays green.
- RAM before/after measured with `docker stats` on the same number of projects — the claim is
  arithmetic, so it gets a number, not a description.
- Every phase adds a tenant-isolation assertion. A phase that cannot demonstrate isolation is not
  finished.
- Live deploy verified by container image tag against `git ls-remote origin refs/heads/main`
  (see `supabase-multitenant-operations` — Coolify serialises deploys and a burst of pushes
  deploys an intermediate commit).

## Risks

- **Cross-tenant leak** via the shared gateway or Studio — the failure mode that makes this
  worthwhile or catastrophic. Mitigated by the isolation suite and by keeping the *data-bearing*
  services per-tenant.
- **Upstream divergence** — this is the fork's defining difference; upstream rebases get harder.
- **Blast radius** — one shared gateway or pooler down means every project down.
