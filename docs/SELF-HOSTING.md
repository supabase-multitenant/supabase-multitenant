# Self-hosting with Coolify

Supabase Multitenant is designed to be easy to self-host. The friendliest path is a
**one-click deploy on [Coolify](https://coolify.io)** — no YAML editing, no manual
Traefik or SSL configuration. This guide covers the one-click path, a manual
Coolify import, and the panel image itself.

---

## What you're deploying

| Piece | Image / source | Role |
|-------|----------------|------|
| **Panel** | `webboxes/supabase-multitenant` | The web control plane (Next.js) + admin auth |
| **Database** | `postgres:16-alpine` | Control-plane metadata (never the project's own DB) |
| **Proxy** | Coolify's built-in Traefik | Routes traffic and issues/renews TLS |

Each project you create gets its **own isolated Supabase stack** — separate
Postgres, GoTrue, Kong (API gateway), Storage, Realtime and Studio. That is the
whole point: **1 infrastructure, many isolated databases.**

---

## One-click from Coolify (recommended)

### 1. Install Coolify

On a fresh Ubuntu 22.04+ / Debian 11+ server with a public IP:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Then open the Coolify dashboard at the URL it prints.

### 2. Deploy Supabase Multitenant

1. Click **Add Service**.
2. Search for **Supabase Multitenant** → click **Deploy**.
3. Coolify provisions:
   - a **Postgres** instance (`db`) for control-plane metadata,
   - the **panel** container, pulling `webboxes/supabase-multitenant`,
4. Coolify injects the runtime values automatically:

   | Coolify variable | Used for |
   |------------------|----------|
   | `SERVICE_USER_POSTGRES` | Postgres user used by the panel |
   | `SERVICE_PASSWORD_POSTGRES` | Postgres password (shared by `db` and the panel) |
   | `SERVICE_PASSWORD_NEXTAUTHSECRET` | Panel session secret |
   | `SERVICE_FQDN_PANEL` | The public domain Coolify assigns to the panel |

5. Coolify routes the panel through its Traefik proxy and serves it over **HTTPS**.

### 3. Create your admin account

1. Open the panel domain Coolify assigned.
2. Register the first (admin) account.
3. Click **Initialize** to pull the Supabase core files.
4. Click **Create Project** to spin up your first isolated Supabase stack.

That's it — you now have a Supabase Cloud-style control plane on your own server.

---

## Manual Coolify deploy (custom)

If the service template isn't available in your marketplace yet, deploy the same
stack directly:

1. In Coolify, create a **project**.
2. **Add a resource** → **Docker Compose**.
3. Paste the compose file from [`deploy/coolify/supabase-multitenant.yml`](../deploy/coolify/supabase-multitenant.yml).
4. Set the domain and let Coolify inject the Postgres credentials and session secret.

> Note: Coolify substitutes magic variables like `${SERVICE_FQDN_PANEL}` in labels
> for the **service-template** path. When you import a compose file manually, set
> the panel domain yourself in the `Host(...)` routing rule. See
> [`deploy/coolify/README.md`](../deploy/coolify/README.md) for details.

---

## Deploying the panel anywhere

The panel is also published on Docker Hub:

```
webboxes/supabase-multitenant:latest
webboxes/supabase-multitenant:1.0.0
```

Run it with a Postgres of your choice and set:

| Env | Purpose |
|-----|---------|
| `DATABASE_URL` | Postgres connection string (control-plane metadata) |
| `NEXTAUTH_SECRET` | Session encryption secret |
| `NEXTAUTH_URL` | The public panel URL |
| `SUPABASE_MULTITENANT_MODE` | `production` |
| `DATA_PATH` | Where project stacks are stored |

See the [Configuration reference](https://supabase-multitenant.github.io/docs/configuration) and the
[Installation guide](https://supabase-multitenant.github.io/docs/installation) on the
site for the full env-var list.

---

## Next steps

- [Quick start](https://supabase-multitenant.github.io/docs/quick-start) — the one-line install on a fresh server.
- [Deploy with Coolify](../README.md#deploy-with-coolify-self-hosted) — the README walkthrough.
- [Testing guide](TESTING.md) — run the panel locally for development.
