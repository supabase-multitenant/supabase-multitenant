# MK as a reference — working protocol and adoption backlog

**MK** is the commercial Supabase starter kit we hold a licence for. It is a **reference** for this
project, never a source of code. This file records the rule, the inventory it drives, and the
know-how we take from it — so the boundary is explicit and auditable.

Its name is deliberately abbreviated to `MK`: this project is open source, and the reference is ours
to learn from, not ours to advertise or to expose.

Local checkout: `../next-supabase-saas-kit-turbo/`.

## Why it can't be more than a reference

The licence prohibits, among other things: distributing the files or derivatives, publishing them
under an open-source licence, **making them publicly available in any form (including public
repositories or freely downloadable packages)**, and creating template/starter-kit products from
them. This panel is intended to be distributable, so MK code cannot be part of it.

Note also: hosting a separate instance per client, and client work, require a higher licence tier
than the developer one.

## The rule

**Take the behaviour, write our own expression.**

Allowed:
- Reading docs and source to understand *what a feature does* and *what edges it handles*.
- Adopting generic, unprotectable concepts: "organizations have members", "members hold roles",
  "roles map to permissions", "invitations expire".
- Testing the running app to observe behaviour.

Not allowed:
- Copying source, even refactored, renamed or re-commented. "A work does not cease to be a
  Derivative merely because it has been substantially modified."
- Porting SQL migrations, schema DDL, or component markup.
- Lifting naming wholesale (a whole table of their identifiers is a tell).

### The procedure (do this every time)

1. **Read to understand, then close the file.** Never edit with their code on screen.
2. **Write the requirement in our own words first** — in the issue or a comment — as behaviour:
   "an invitation is single-use and bound to one email address". No mention of their tables,
   columns or functions.
3. **Design from that description**, using our own structures, names and helpers. If our existing
   code already has a principle that fits (e.g. our anti-escalation rule), reuse *ours*.
4. **Check by diff instinct:** if our file and theirs could be placed side by side and look like
   relatives, rewrite ours. Same shape is fine when the shape is generic; same *expression* is not.
5. **Never copy SQL.** Migrations and DDL are the highest-risk artifacts — pure expression. Write our
   own schema for our own requirements.

The rule is enforced mechanically by `tests/no-upstream-code.test.ts`, which fails the build if
upstream identifiers appear in `src/`, `prisma/` or `tests/`. It is the one file that must contain
those identifiers, because a detection rule has to name what it detects.

## What we take from MK — the know-how

Grouped by the idea, not by how MK built it. Each entry is the **behaviour worth having**, written
so it can be implemented from scratch. The backlog items derived from these are on the board
(`supabase-multitenant` project #1), each titled `MK:` so the source stays internal.

### Tenancy model

1. **Authorization lives in the database, not only in application code.**
   The strongest idea in their design. Their permission checks are database functions and their row
   policies call them, so a bug in a request handler cannot leak another tenant's rows — the
   database refuses. Our equivalent rule lives in `src/lib/authz.ts`, which is correct but only as
   good as every route remembering to call it. **We want:** a forgotten check on one code path to be
   incapable of leaking data.

2. **One account concept for personal and team tenancy.**
   They have no "project with no organization" state: signing up creates your personal account, and
   every project belongs to one. Our org-less projects are a special case with real hazards — they
   are visible only to their creator, and the project→organization foreign key nulls on delete,
   which would orphan containers and volumes. **We want:** the special case to stop existing.

3. **A numeric hierarchy level per role, including custom ones.**
   Their roles carry a level, and one generic rule answers "may this actor act on that member?":
   the owner may; the owner may not be acted on; otherwise compare levels. Our built-in roles have
   ranks, but our **custom roles have no level at all**, so nothing generic stops a custom-role
   holder acting on someone above them. **We want:** one rule, no per-case owner checks.

### Credential lifecycle

4. **Multi-factor authentication, and step-up requirements for sensitive operations.**
   An account can enrol a second factor, and certain actions demand a stronger session — their
   super-admin check requires both the role *and* a second-factor session. **We want:** a second
   factor available, and destructive or system-wide actions requiring it.

5. **Short-lived, single-use codes for one-off confirmations.**
   A code that is bound to one purpose (confirming an address, approving a sensitive change), is
   consumed on use, and expires on its own. Distinct from a password reset link. **We want:** a
   confirmation primitive that cannot be replayed or redirected to another purpose.

6. **Password reset as a first-class, non-enumerable flow.** *(adopted)*
   Requesting a reset must not reveal whether an address exists, the token is single-use and
   expiring. Ours is implemented and shipped.

### Membership lifecycle

7. **An invitation is single-use, bound to one address, and expires.** *(adopted)*
   Ours additionally stores only a hash of the token and revokes a superseded link. Shipped and
   verified end to end.

8. **Invitation renewal and explicit revocation** *(partially ours)*
   Beyond expiry: an owner can extend a pending invitation and revoke one deliberately. Ours revokes
   by superseding, but there is no renew and no explicit revoke.

9. **Ownership transfer and leaving an organization.** *(adopted)*
   The owner hands the organization to an existing member; a member may leave; the owner may not
   leave without transferring first, because an ownerless organization cannot be repaired from the
   UI. Shipped and verified.

10. **Transactional email as a delivery channel.**
    Invitations and resets are delivered by email rather than by copying a URL out of an API
    response. Ours returns the invite URL to the caller because no provider is wired. **We want:**
    delivery that doesn't depend on the admin being present.

### Operations and product

11. **A system-wide admin area, gated more strictly than an organization role.**
    A surface across *all* organizations, users and projects, reachable only by a global role and
    ideally requiring a second factor. **We want:** platform operations to stop being SQL and shell.

12. **Plan-based entitlements and limits.**
    Their billing ties plans to what an account may do. We already carry a plan field on
    organizations but nothing reads it. **We want:** limits expressed per plan (projects, paused
    projects, storage) so the platform has a real notion of a free tier.

13. **Database-level tests as a discipline, not just unit tests.**
    Their security properties are tested against the database itself. Our 380-odd tests are mostly
    pure-function units; the invariants that matter for tenancy are only asserted in application
    code. **We want:** tests that assert the database refuses what it should refuse.

14. **An audit trail the operator can actually read.**
    We record audit entries already; nobody can see them. **We want:** the existing log surfaced.

### Where we already lead

- **Permission granularity**: our catalog has 25 concrete permissions against their 5 coarse flags —
  necessary for our viewer → developer → admin → custom-rules ladder.
- **Custom roles defined in-app**: they ship role *assignment* with seeded roles; we let an
  administrator define roles, bounded by an anti-escalation rule (you may only grant what you hold).
- **The control plane itself**: provisioning self-hosted Supabase stacks, namespacing, routing,
  backups/restore, cloud→self-hosted migration. They have no equivalent.

## Adoption status

| Entry | Status |
| --- | --- |
| 6. Password reset | done |
| 7. Invitations | done, verified |
| 9. Ownership transfer + leave | done, verified |
| 3. Role hierarchy + generic member rule | next |
| 1. Database-enforced authorization | next |
| 4. MFA + step-up | planned |
| 5. One-off confirmation codes | planned |
| 8. Invitation renew / revoke | planned |
| 10. Transactional email | planned |
| 11. System-wide admin area | planned |
| 12. Plan-based entitlements | planned |
| 13. Database-level tests | planned |
| 14. Audit trail in the UI | planned |
| 2. Unified account concept | deferred (touches the data model) |
