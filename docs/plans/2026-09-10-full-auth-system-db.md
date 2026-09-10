# Full AUTH + System DB + Supabase-like UX — Implementation Plan

> **For Hermes:** execute task-by-task; log new bugs/ideas into the backlog as discovered.

**Goal:** Give `supabase-multitenant` full authentication (Auth.js), a users/roles/admin
system, and a `supabase-multitenant-system-main-db` control-plane database that indexes
every managed database — wrapped in a Supabase.com-like dashboard UX.

**Architecture:**
- **Auth.js v5** (`next-auth@beta`) + `@auth/prisma-adapter` replaces the bespoke
  session auth. Providers: Credentials (bcryptjs) + GitHub (extensible to Google/SSO).
- **RBAC**: `owner > admin > member` at organization scope, enforced server-side on every
  API route via `requireRole()`. UI mirror of the Supabase *Team* page.
- **System DB** `supabase-multitenant-system-main-db`: the control-plane Postgres that
  holds users, organizations, members, settings and a **registry of every managed DB**
  (name, slug, region, status, owner, ports, key refs). Credentials are generated on first
  login and stored in `~/.secure-upload/supabase-multitenancy/`.
- **UX**: organizations → projects → project overview, mirroring the attached Supabase.com
  screenshots (dark theme, breadcrumb, org switcher, ⌘K search, account menu, theme picker).

**Tech stack:** Next 15.5 (App Router, RSC), React 19, Prisma 6 / Postgres, Auth.js v5,
Tailwind + Radix, recharts, Docker/Coolify.

---

## Milestones

| # | Milestone | Outcome |
|---|-----------|---------|
| M0 | Foundations & Decisions | ADRs written; Auth.js v5 spike proven on this stack |
| M1 | Auth.js Integration | Auth.js replaces bespoke sessions; admin migrated; login/register/logout |
| M2 | Users, Roles & RBAC | owner/admin/member enforced on every route; team + invites UI |
| M3 | System DB & Registry | `supabase-multitenant-system-main-db` bootstrapped; registry synced; admin overview API |
| M4 | Supabase-like UX | Orgs list/wizard, org layout, projects grid, new-project wizard, project overview |
| M5 | Admin Overview & Settings | Admin page: all DBs, users, roles, system health; system settings |
| M6 | Hardening, Docs & Release | Tests, docs, security review, release + one-click template update |

## Key decisions / risks
1. **next-auth v4 → v5 (beta).** Repo already depends on `next-auth@^4.24.11` but uses a
   bespoke `src/lib/auth.ts`. Plan: upgrade to v5 and route all auth through Auth.js.
2. **System DB topology.** Decision: bootstrap the system DB through the panel's own
   project pipeline (dogfooding) and keep the Prisma control-plane schema authoritative,
   mirroring a registry table into the system DB. Documented in an ADR issue; flagged for
   owner confirmation because it drives M3.
3. **Cookie scope.** Sessions are host-scoped today; for a single login across the panel and
   every `<slug>-studio` subdomain set `cookie.domain = .<zone>` (config-driven).
4. **No global DNS/IP/port-forward changes.** Production (Coolify, All0e) must stay intact.

## Task order
M0 → M1 → M2 → M3 → M4 → M5 → M6. Within M1 the critical path is
deps → schema → auth config → route migration → admin migration → UI → tests.

## Verification per milestone
- **M1:** credentials login returns a session; OAuth callback mocked; `/dashboard` gated by Auth.js.
- **M2:** RBAC matrix test — every role × every action; 403 for insufficient role.
- **M3:** bootstrap idempotent (2nd run = no-op); registry reflects create/delete.
- **M4:** visual parity checklist against the 7 reference screenshots.
- **M5:** admin sees all DBs + users; non-admin 403.
- **M6:** e2e register → org → project → Studio-via-gateway; docs published.
