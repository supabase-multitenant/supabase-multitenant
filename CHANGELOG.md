# Changelog

All notable changes to **supabase-multitenant** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Implementation plan + roadmap: full Auth.js auth, users/roles/RBAC, system DB
  (`supabase-multitenant-system-main-db`), and a Supabase.com-like dashboard UX
  (`docs/plans/2026-09-10-full-auth-system-db.md`, backlog #1–#74).
- ADR-0001 (Auth.js v5 + Prisma adapter) and ADR-0002 (system DB topology).
- App-level Studio gateway: per-project Studio is now served behind the panel's own session
  auth via a pretty `*.sslip.io` subdomain (header + internal rewrite; no redirect loop).

### Fixed
- Studio subdomain redirect loop caused by Traefik `addPrefix` + Next trailing-slash
  normalization.
- Login redirect emitted the container-internal `http://0.0.0.0:3000` URL; redirects are now
  relative to the public host.
- Route-root 404 (`[...rest]` → optional catch-all `[[...rest]]`).
- Panel `/dashboard` was only client-guarded; now enforced server-side in middleware.

### Security
- Closed public exposure of the per-project stack: Postgres `:19601` and pooler `:20601` are
  now loopback-only; API `:17601` and Studio `:17701` bind to the private bridge. No global
  firewall/DNS/port-forward changes; production ports untouched.

## [1.0.0] - 2026-09-09
### Added
- Initial self-hosted multi-tenant Supabase panel (Next 15, Prisma, Docker/Coolify).
- Per-project isolated Supabase stacks (db, auth, rest, storage, realtime, studio, …).
- One-click Coolify template; Docker Hub image `webboxes/supabase-multitenant`.
