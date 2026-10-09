# Parity with Supabase Cloud — the gap inventory

Cloud is the reference product: one control plane, many projects, and a dashboard for every part of
the lifecycle. This file is the honest difference between that and what this deployment does today,
one row per gap, each pointing at the issue that closes it.

Prepared 2026-10-09. Board: <https://github.com/orgs/supabase-multitenant/projects/1>.

## Already at parity (verified, not assumed)

| Capability | Evidence |
|---|---|
| Organizations, projects, members | orgs/projects/members in the control plane, RBAC enforced per permission |
| One isolated database per project | own Postgres container per project, `supabase_multitenant` inside it |
| Per-project API + keys | `ANON_KEY` / `SERVICE_ROLE_KEY` minted from that project's `JWT_SECRET` |
| Studio per project | served on its own host, one session across the platform's hosts |
| Pause / resume (hibernation) | `stop` then `start`, containers and volumes kept |
| System administrator view | `/admin` for the panel owner and system admin only |
| On-demand services | core `db+rest+auth` always; realtime/storage/functions/dashboard in groups |
| Shared gateway | one envoy serving every tenant, one listener port per tenant |

## Gaps, in the order they will be closed

| Priority | Gap | Issue |
|---|---|---|
| P0 | new projects are born broken — DSNs missing and the panel env overrides each project .env | [#145](https://github.com/supabase-multitenant/supabase-multitenant/issues/145) |
| P0 | OAuth providers — per-project provider configuration in the panel | [#146](https://github.com/supabase-multitenant/supabase-multitenant/issues/146) |
| P1 | auth email per project — SMTP, sender, templates | [#147](https://github.com/supabase-multitenant/supabase-multitenant/issues/147) |
| P1 | service opt-in per project — realtime, storage, functions — with live status | [#148](https://github.com/supabase-multitenant/supabase-multitenant/issues/148) |
| P1 | edge functions managed from the panel — deploy, list, secrets, logs | [#149](https://github.com/supabase-multitenant/supabase-multitenant/issues/149) |
| P1 | backups — scheduled, downloadable, restorable | [#150](https://github.com/supabase-multitenant/supabase-multitenant/issues/150) |
| P1 | logs — per-service, queryable from the panel | [#151](https://github.com/supabase-multitenant/supabase-multitenant/issues/151) |
| P1 | custom domains + TLS, end to end | [#152](https://github.com/supabase-multitenant/supabase-multitenant/issues/152) |
| P2 | API key rotation with gateway refresh | [#153](https://github.com/supabase-multitenant/supabase-multitenant/issues/153) |
| P2 | usage and health per project — db size, connections, requests, MAU | [#154](https://github.com/supabase-multitenant/supabase-multitenant/issues/154) |
| P2 | panel mail transport — invites and password resets by email | [#155](https://github.com/supabase-multitenant/supabase-multitenant/issues/155) |
| P2 | storage parity — buckets, policies and a panel entry point | [#156](https://github.com/supabase-multitenant/supabase-multitenant/issues/156) |
| P3 | database settings — Postgres config, extensions, network restrictions | [#157](https://github.com/supabase-multitenant/supabase-multitenant/issues/157) |
| P3 | branching and read replicas | [#158](https://github.com/supabase-multitenant/supabase-multitenant/issues/158) |
| P3 | audit log surface for the panel | [#159](https://github.com/supabase-multitenant/supabase-multitenant/issues/159) |

## Deliberately out of scope

- **Billing, plans, quotas** — this is OSS and self-hosted; the inherited pricing surfaces were
  removed rather than re-implemented.
- **Multi-region duplication** — a single host is the deployment.
- **Managed SMTP / one-click OAuth app creation** — provider apps must be registered in each
  provider's console by the account owner; the panel can only store and apply the credentials.

## The rule these gaps share

A gap is only closed when the panel does it *and* the result is observable from a browser: a URL
to open, a thing to click, and an outcome that is true on the wire. Anything that needs shell
access is still a gap.
