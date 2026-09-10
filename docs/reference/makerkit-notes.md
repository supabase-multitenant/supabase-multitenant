# MakerKit as a reference — working protocol

We hold a commercial licence for the MakerKit Supabase Turbo kit. It is a **reference** for this
project, never a source of code. This file records the rule and the inventory it drives, so the
boundary is explicit and auditable.

Local checkout: `../next-supabase-saas-kit-turbo/` (docs under its `docs/`).

## Why it can't be more than a reference

Their EULA prohibits, among other things: distributing the files or derivatives, publishing them
under an open-source licence, **making them publicly available in any form (including public
repositories or freely downloadable packages)**, and creating template/starter-kit products from
them. This panel is intended to be distributable, so MakerKit code cannot be part of it.

Note also: hosting a separate instance per client and client work require the **Team** licence,
not the Developer licence.

## The rule

**Take the behaviour, write our own expression.**

Allowed:
- Reading their docs and source to understand *what a feature does* and *what edges it handles*.
- Adopting generic, unprotectable concepts: "organizations have members", "members hold roles",
  "roles map to permissions", "invitations expire".
- Testing their running app to observe behaviour.

Not allowed:
- Copying source, even refactored, renamed or re-commented. "A work does not cease to be a
  Derivative merely because it has been substantially modified."
- Porting their SQL migrations, schema DDL, or component markup.
- Lifting their naming wholesale (a whole table of their identifiers is a tell).

Practically: read it, close it, describe the requirement in our own words in the issue, then
implement against that description. If a diff would look familiar side by side, rewrite it.

## Inventory — what they have that we want

Derived from their docs and a feature survey. Ordered by value to our phases, not by how they
built it.

| Feature | Their coverage | Our phase | Our status |
| --- | --- | --- | --- |
| Email + password auth, OAuth | full | 0 | done (Auth.js) |
| Password reset | full | 0 | **missing** |
| MFA / TOTP | full | later | missing |
| One-time codes (OTP) | full | later | missing |
| Organizations / team accounts | full | 1 | partial (create + list) |
| Members: list, change role, remove | full | 0 | done |
| **Invitations** (invite people without accounts, accept, renew, revoke) | full | **1** | **missing — building now** |
| Ownership transfer | full | 1 | missing |
| Leave organization | full | 1 | missing |
| Custom roles defined in-app | partial (roles are seeded; assignment UI only) | 0 | done, and finer-grained than theirs |
| Permissions enforced in the database (RLS), not only app code | full | 1 | **missing — worth doing** |
| Admin / super-admin area | full | later | missing |
| Billing (Stripe + per-seat) | full | later | missing |
| i18n, marketing pages, CMS, emails, analytics | full | later | missing |
| Postgres migrations discipline + RLS hardening | full | ongoing | partial |

### Where we already lead

- **Permission granularity**: our catalog has 25 concrete permissions; theirs is a 5-value enum.
  Necessary for the "viewer → developer → admin → custom rules" ladder.
- **Custom roles**: they ship role *assignment*; roles are seed data. We let an administrator
  define roles in the UI, bounded by an anti-escalation rule (you may only grant what you hold).
- **The control plane itself**: provisioning self-hosted Supabase stacks, namespacing, routing,
  backups/restore, cloud→self-hosted migration. They have no equivalent.

## Next adoptions, in order

1. **Invitations** — unblocks "add people to the organization" (phase 1).
2. **Password reset** — closes the last real auth gap.
3. **Database-enforced permissions** — move authorization into RLS so a bug in a route handler
   cannot leak data. This is the strongest idea in their design.
4. **Ownership transfer + leave organization** — completes the org lifecycle.
5. **Admin area** — after phases 1–2.
