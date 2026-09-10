# ADR-0001 — Adopt Auth.js v5 + Prisma adapter (replace the bespoke session auth)

- **Status:** Accepted
- **Date:** 2026-09-10
- **Issue:** #68
- **Supersedes:** the bespoke session system in `src/lib/auth.ts` + `users`/`sessions` tables

## Context

The panel (inherited) authenticates with a hand-rolled session system:

- `src/lib/auth.ts` — `validateSession(token)` reads a `sessions` table;
- `src/app/api/auth/{login,logout,register,registration-status}` — bcryptjs (`$2b$12$`)
  password checks, a cookie named `session`, first-admin-only registration;
- `prisma/schema.prisma` — `User`, `Session`, `PasswordResetToken`, plus an unused
  `TeamMember` with a `role` column that nothing enforces.

We need **full auth capability**: multiple providers, sessions that can be revoked,
account linking, email verification, and a first-class `User`/role model that RBAC and the
admin overview can build on. Re-implementing all of that by hand is a liability.

## Decision

Adopt **Auth.js v5** (`next-auth@beta`) with the **`@auth/prisma-adapter`**.

- Providers: **Credentials** (bcryptjs, preserving existing `$2b$12$` hashes) and **GitHub**
  (extensible to Google / generic OIDC later).
- Session strategy: **database sessions** (revocable server-side; needed for "disable user"
  and admin "sign out everywhere").
- The panel keeps bcryptjs for password verification inside the Credentials provider; no
  existing password is invalidated.

## Consequences

**Positive**
- One auth path for panel + Studio gateway + future admin APIs.
- Account linking, verification, and provider expansion come for free.
- Revocable sessions (database strategy) make "disable user" real.

**Negative / risks**
- `next-auth` is already a dependency at **v4**; v5 is `@beta`. Migration churn.
- Auth.js owns the schema (`Account`, `Session`, `VerificationToken`), so the existing
  `Session` model changes shape — requires a data migration for the live admin.
- Next 15.5 + React 19 compatibility must be proven (spike, issue #21) before broad edits.

## Alternatives considered

1. **Keep the bespoke system, bolt on providers.** Rejected: we would rebuild Auth.js badly,
   including OAuth state/PKCE, account linking and revocation.
2. **Lucia / iron-session.** Rejected: Lucia is deprecated (author's recommendation now is to
   roll your own or use Auth.js); iron-session is cookie-only and does not provide the
   provider/adapter ecosystem we need.
3. **External IdP (Keycloak/Authentik) in front of the panel.** Deferred: heavier operationally
   for a single-tenant self-hosted panel; revisit if org-level SSO (issue #65) lands.

## Acceptance

- ADR committed here.
- Spike (issue #21) proves Credentials + GitHub on Next 15.5 / React 19 / Prisma 6.
- M1 completes with no `validateSession` references left and the production admin able to
  sign in unchanged.
