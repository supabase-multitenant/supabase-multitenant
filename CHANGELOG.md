# Changelog

All notable changes to **supabase-multitenant** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **ADR-0003: shared infrastructure plane, per-tenant databases.** The platform is stood up
  **once** — one gateway, one pooler, one dashboard, one imgproxy — and a new project adds only a
  database plus the services that physically cannot multiplex. This supersedes the inherited
  "full isolated stack per project" model, which duplicated ~half of every stack (measured: one
  idle project = 1,616.8 MiB across 11 containers, of which 832 MiB is infrastructure copied
  again). Implementation plan: `docs/plans/2026-09-23-shared-infrastructure-plane.md`.
- **Phase 0 — the shared-plane boundary as a tested invariant** (`src/lib/shared-plane.ts`,
  `tests/shared-plane.test.ts`). `splitProjectCompose()` lifts the shared services out of a
  generated stack and throws `SharedPlaneLeakError` rather than ever emitting one that still
  carries duplicated infrastructure. Verified against the real 589-line generated compose:
  hoists `studio, api-gw, imgproxy, meta, supavisor`; keeps `auth, rest, realtime, storage,
  functions, db`; trailer preserved. Footprint reference: `docs/reference/service-footprint.md`.
- **Phase 1 (build) — the shared gateway** (`src/lib/gateway.ts`, `tests/gateway.test.ts`).
  One envoy for every tenant instead of one per project. The per-project listener ships
  `domains: ['*']`, which is only safe while each tenant has its own gateway and port; collapsed
  into one, it means every tenant's listener answers for every host. `buildSharedGateway()`
  therefore restricts each virtual host to its own host, namespaces every cluster reference
  (`auth` → `<slug>-auth`), and **throws** rather than emit a listener that still matches any host
  or that references a cluster it does not own.
  Verified against the real 1,101-line `lds.template.yaml`: 1 wildcard → 0 in the shared listener;
  42 cluster references, 0 owned by nobody; 14 namespaced clusters in the CDS, none un-namespaced;
  tenant A's segment contains no reference to tenant B.

## [1.1.0] - 2026-09-23

### Added
- Implementation plan + roadmap: full Auth.js auth, users/roles/RBAC, system DB
  (`supabase-multitenant-system-main-db`), and a Supabase.com-like dashboard UX
  (`docs/plans/2026-09-10-full-auth-system-db.md`, backlog #1–#74).
- ADR-0001 (Auth.js v5 + Prisma adapter) and ADR-0002 (system DB topology).
- App-level Studio gateway: per-project Studio is now served behind the panel's own session
  auth via a pretty `*.sslip.io` subdomain (header + internal rewrite; no redirect loop).
- **Edge-function secrets** (#112, contributed by [@TeitoShiota](https://github.com/TeitoShiota)):
  per-project environment variables exposed only to that project's Edge Functions. Stored in a
  separate `ProjectFunctionSecret` model — not `ProjectEnvVar` — so the stack `.env` (ports,
  database password, hosts) never reaches function scope. Wired through a per-project
  `docker/.env.functions` file referenced by the `functions` service `env_file` (Supabase's own
  self-hosting convention), with a pure validation module, reserved-key rejection, idempotent
  compose wiring, and audit records that store **key names only**.

### Fixed
- Studio subdomain redirect loop caused by Traefik `addPrefix` + Next trailing-slash
  normalization.
- Login redirect emitted the container-internal `http://0.0.0.0:3000` URL; redirects are now
  relative to the public host.
- Route-root 404 (`[...rest]` → optional catch-all `[[...rest]]`).
- Panel `/dashboard` was only client-guarded; now enforced server-side in middleware.
- **Control-plane session secret was the public default.** `docker-compose.yml` referenced
  `${NEXTAUTH_SECRET:-supabase-multitenant-change-me-please}`, which makes Coolify register a
  variable whose value *is* that literal default — so the panel signed sessions with a
  publicly known string. It now references Coolify's generated
  `SERVICE_PASSWORD_NEXTAUTHSECRET`, matching the one-click template.

### Security
- Closed public exposure of the per-project stack: Postgres `:19601` and pooler `:20601` are
  now loopback-only; API `:17601` and Studio `:17701` bind to the private bridge. No global
  firewall/DNS/port-forward changes; production ports untouched.

### Dependencies
- React 19.2.3 → 19.3.0 (+ `@types/react`), `@radix-ui/react-label` → 2.1.15,
  Prisma 6.19.1 → 6.19.3, Autoprefixer → 10.5.5, `@eslint/eslintrc` → 3.3.7.
- CI actions: `actions/setup-node` → v7, `actions/cache` → v6, `docker/login-action` → v4,
  `docker/metadata-action` → v6, `softprops/action-gh-release` → v3.
- Repository: created the `version:patch` / `version:minor` / `version:major` / `skip-version`
  / `dependencies` labels the release workflows require. They had never existed, so every
  Dependabot PR was permanently blocked on the *Check Version Label* job.

## [1.0.0] - 2026-09-09
### Added
- Initial self-hosted multi-tenant Supabase panel (Next 15, Prisma, Docker/Coolify).
- Per-project isolated Supabase stacks (db, auth, rest, storage, realtime, studio, …).
- One-click Coolify template; Docker Hub image `webboxes/supabase-multitenant`.
