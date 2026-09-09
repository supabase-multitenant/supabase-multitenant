# Coolify 1-Click Deploy — Supabase Multitenant

This directory contains everything needed to submit **Supabase Multitenant** as a
one-click deploy service in Coolify.

## Files

| File | Purpose |
|------|---------|
| `supabase-multitenant.yml` | The docker-compose service definition in Coolify's one-click template format. |
| `metadata.json` | The `service-templates.json` entry (`compose` = base64 of the YAML). |

## What it deploys

One **control-plane** container (`webboxes/supabase-multitenant`)
+ a bundled **Postgres 16** (named `db`, to avoid colliding with Coolify's own
`postgres` alias on the shared proxy network). The panel mounts the **host Docker
socket** so, from its UI, you can **Create Project** → it spins up a fresh,
**isolated Supabase stack** (own Postgres, GoTrue, Kong, Storage, Realtime) per
project — i.e. your "1 infra, many isolated databases" Supabase Cloud experience.

## Env vars Coolify auto-injects

| Env | Source |
|-----|--------|
| `SERVICE_USER_POSTGRES` | Coolify-generated DB user |
| `SERVICE_PASSWORD_POSTGRES` | Coolify-generated DB password (shared by `db` + panel `DATABASE_URL`) |
| `SERVICE_PASSWORD_NEXTAUTHSECRET` | Coolify-generated session secret |
| `SERVICE_FQDN_PANEL` | Coolify-generated FQDN → used in Traefik routing labels |
| `VERSION`, `APP_NAME` | optional overrides |

## Routing

The panel is served by Coolify's Traefik proxy via `SERVICE_FQDN_PANEL` in the
labels. In a one-click **service** template Coolify substitutes these magic vars
at deploy time (the same mechanism as the stock `supabase` template).

> ⚠️ Note: if you deploy this same compose as a **dockercompose build-pack app**
> (git-based), Coolify does **not** substitute `${SERVICE_FQDN_PANEL}` into labels
> — it renders literally. In that path hardcode the app's FQDN in the `Host(...)`
> rule. This template uses the **service** path, where substitution works.

## Keeping the two files in sync

`metadata.json`'s `compose` field must be the base64 of `supabase-multitenant.yml`.
Regenerate after editing the YAML:

```bash
python3 -c "import base64,json; c=open('deploy/coolify/supabase-multitenant.yml').read(); \
m=json.load(open('deploy/coolify/metadata.json')); m['compose']=base64.b64encode(c.encode()).decode(); \
json.dump(m, open('deploy/coolify/metadata.json','w'), indent=2)"
```

## How to submit to Coolify

1. Copy `deploy/coolify/supabase-multitenant.yml` → Coolify repo `templates/compose/supabase-multitenant.yml`.
2. Add the `metadata.json` entry to `service-templates.json` with `slug: supabase-multitenant`.
3. Add the SVG logo (or reuse `svgs/supabase.svg`).
4. Open a PR against `coollabsio/coolify`.
