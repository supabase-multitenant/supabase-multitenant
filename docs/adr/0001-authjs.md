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
- Session strategy: **JWT** (signed cookie). *Discovered during implementation:* Auth.js only
  supports the Credentials provider with the JWT strategy — database sessions are
  unsupported with Credentials. Revocability is therefore handled with a DB re-check in the
  `jwt` callback plus a planned `User.sessionVersion` (issue #76).
- Session cookie is named **`session`** (the name the legacy system used) so the existing
  middleware, API routes and the Studio gateway keep working unchanged while the engine
  underneath is swapped for Auth.js.
- The panel keeps bcryptjs for password verification inside the Credentials provider; no
  existing password is invalidated.
- `trustHost: true`; secret resolves from `AUTH_SECRET` → `NEXTAUTH_SECRET` →
  `SERVICE_PASSWORD_NEXTAUTHSECRET` (the Docker image already generates the latter).

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

**Implementation findings (2026-09-10)**
- ✅ Spike confirmed: Auth.js v5 `5.0.0-beta.32` + `@auth/prisma-adapter` 2.11.3 build and run
  on Next 15.5.9 / React 19 / Prisma 6.19.
- ⚠️ **Credentials + database sessions is not supported** → JWT strategy adopted (above).
- ⚠️ **`prisma db push` crash-looped the live panel** when adding required columns to the
  non-empty `sessions` table (`--accept-data-loss` does not cover this). Fixed by truncating
  the disposable sessions table; the durable fix is tracked in issue #75 / #78.
- ⚠️ Auth.js emits `http://localhost:3000` redirect targets because `AUTH_URL` is unset
  behind the proxy — tracked in issue #77.

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
