# Coolify 1-Click Deploy — Supabase Multitenant

This directory contains everything needed to submit **Supabase Multitenant** as a
one-click deploy service in Coolify.

## Files

| File | Purpose |
|------|---------|
| `supabase-multitenant.yml` | The docker-compose service definition, in Coolify's one-click template format (frontmatter `# documentation:`, `# slogan:`, `# category:`, `# tags:`, `# logo:`, `# port:` comments). |
| `metadata.json` | The `service-templates.json` entry: `documentation`, `slogan`, `compose` (base64 of the YAML above), `tags`, `category`, `logo`, `minversion`, `template_last_updated_at`, `port`. |

## What it deploys

One **control-plane** container (`ghcr.io/supabase-multitenant/supabase-multitenant`)
plus a bundled **Postgres 16** for the panel's own metadata. The panel mounts
the **host Docker socket** (`/var/run/docker.sock`) so that, from its UI, you can
**Create Project** → it spins up a fresh, **isolated Supabase stack** (own Postgres,
GoTrue, Kong, Storage, Realtime) per project on the same host — i.e. your
"1 infra, many isolated databases" Supabase Cloud-style experience.

- **Image:** `ghcr.io/supabase-multitenant/supabase-multitenant:<VERSION>` (default `latest`)
- **Panel port:** `3000`
- **Requires:** Docker socket access (the whole point — it provisions sibling stacks).

## Service template fields

Frontmatter + metadata are both set, matching Coolify's existing entries (e.g.
the stock `supabase` template):

```yaml
# documentation: https://github.com/supabase-multitenant/supabase-multitenant
# slogan: Run your own Supabase Cloud-style multi-tenant control plane. 1 infrastructure, many isolated databases.
# category: backend
# tags: supabase, multitenant, self-hosted, database, backend
# logo: svgs/supabase.svg
# port: 3000
```

## Env vars Coolify will auto-inject

The compose uses Coolify's `SERVICE_*` convention so credentials/fqdn are
generated per-deployment:

| Env | Source |
|-----|--------|
| `SERVICE_USER_POSTGRES` | Coolify-generated DB user |
| `SERVICE_PASSWORD_POSTGRES` | Coolify-generated DB password |
| `SERVICE_PASSWORD_NEXTAUTHSECRET` | Coolify-generated session secret |
| `POSTGRES_DB`, `APP_NAME`, `VERSION`, `PORT` | optional user overrides |

## How to submit to Coolify

1. Copy `deploy/coolify/supabase-multitenant.yml` → Coolify repo `templates/compose/supabase-multitenant.yml`.
2. Add the `metadata.json` entry to `service-templates.json` with `slug: supabase-multitenant`.
3. Add the SVG logo (or reuse `svgs/supabase.svg`).
4. Open a PR against `coollabsio/coolify`.

Keep the two files in sync — `metadata.json`'s `compose` field is the base64 of
`supabase-multitenant.yml`. Regenerate with:

```bash
python3 -c "import base64,json; c=open('deploy/coolify/supabase-multitenant.yml').read(); \
m=json.load(open('deploy/coolify/metadata.json')); m['compose']=base64.b64encode(c.encode()).decode(); \
json.dump(m, open('deploy/coolify/metadata.json','w'), indent=2)"
```
