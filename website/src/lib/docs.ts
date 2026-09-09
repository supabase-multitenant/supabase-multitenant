// Central docs registry: navigation structure + per-page content.
// Content is written as Markdown and rendered by the DocsLayout.

export interface DocNavGroup {
  id: string
  label: string
  items: string[] // doc slugs
}

export interface DocPage {
  slug: string
  group: string
  title: string
  description: string
  content: string
}

export const NAV: DocNavGroup[] = [
  { id: 'getting-started', label: 'Getting Started', items: ['introduction', 'quick-start', 'installation', 'local-development'] },
  { id: 'architecture', label: 'Architecture', items: ['architecture', 'networking'] },
  { id: 'management', label: 'Project Management', items: ['projects', 'environment-variables', 'custom-domains', 'deployments'] },
  { id: 'platform', label: 'Platform', items: ['authentication', 'configuration', 'api', 'troubleshooting', 'faq'] },
]

const introduction = `# Introduction

**Supabase Multitenant** lets you self-host Supabase as your own Supabase.com-style cloud. It runs anywhere you choose — a VPS, Coolify, Dokku, Dokploy, or your own infrastructure — and gives you a single platform that manages many **isolated Supabase databases**.

The core idea is simple: **1 infrastructure, many isolated databases.**

Instead of provisioning a whole server per Supabase project, you run one control plane and let it spin up, route, and tear down an individual Supabase stack for every project you create.

## Why multitenant Supabase?

- **One-command deployment** — take a fresh Linux server to a running panel + Traefik + Postgres with a single install script.
- **True isolation** — each project gets its own database, API (Kong), Auth, Studio, Realtime, Storage and connection pooler.
- **Your infrastructure** — no vendor lock-in. Data stays on the hardware you own.
- **Automatic HTTPS** — Traefik issues and renews Let's Encrypt certificates for every project domain.
- **One dashboard** — create, configure, deploy and monitor every project from a single place.

## The building blocks

| Piece | Role |
|-------|------|
| **Panel** | The web control plane (Next.js) + admin auth, reached on port \`3000\` |
| **Control database** | A single Postgres that stores panel settings and project metadata |
| **Traefik** | The edge reverse proxy that routes traffic and manages TLS |
| **Supabase core** | The cloned \`supabase/supabase\` repo used as the source of each project stack |
| **Projects** | Isolated Supabase stacks, one per project, each with its own service set |

Head over to [How it works](/how-it-works) for the full architecture walkthrough, or jump straight into the [Quick start](/docs/quick-start).
`

const quickStart = `# Quick start

Get a running platform in a few minutes. The fastest path is the one-line installer on a fresh Linux server (Ubuntu 22.04+ or Debian 11+), run as **root**.

\`\`\`bash
# One-line install
curl -sSL https://supabase-multitenant.github.io/get | sh
\`\`\`

The installer:

1. Installs Docker (and enables it as a service) if it isn't already present.
2. Creates the data directory (\`/etc/supabase-multitenant\`) with \`core\`, \`projects\`, \`traefik\` and \`postgres\` folders.
3. Generates secure secrets and writes a \`.env\`.
4. Writes a \`docker-compose.yml\` (Traefik + Postgres + the panel) and a Traefik static config.
5. Starts the stack and reports the panel URL.

## First login

Open \`http://YOUR_SERVER_IP:3000\`. Because no admin exists yet, you'll be taken to a **registration** screen — the **first account** you create becomes the administrator. After that, registration is closed and the dashboard is protected by that account.

> You can only self-register the very first account. Everyone after that is invited or created by an administrator.

## Create your first project

1. Click **Initialize** to clone the Supabase core repository into \`core/\` (this can take a few minutes).
2. Click **New Project**, give it a name and description.
3. Configure its environment variables on the project page.
4. Click **Deploy** — the panel writes a per-project docker-compose and brings the stack up.

Your project's API (Kong) and Studio are routed automatically and exposed from the ports you configured (defaults: Kong \`8000\`, Studio \`3000\`).
`

const installation = `# Installation

The supported production install path targets a fresh Linux VM with root access and ports 80, 443 and 3000 free.

## Requirements

- Ubuntu 22.04 LTS+ or Debian 11+
- Root SSH access (\`sudo\` is not enough — the installer must run as root)
- Ports **80**, **443** (Traefik) and **3000** (panel)
- A domain (recommended) or a public IP to reach the panel

The script refuses to run on macOS and inside containers, and checks that ports 80/443/3000 are free before it starts.

## Run the installer

\`\`\`bash
curl -sSL https://supabase-multitenant.github.io/get | sh
\`\`\`

This writes everything under \`/etc/supabase-multitenant\`:

\`\`\`text
/etc/supabase-multitenant
├── core/                 # cloned supabase/supabase repo
├── projects/             # one directory per Supabase project
├── traefik/
│   ├── dynamic/          # auto-generated routing configs
│   └── acme/             # Let's Encrypt certificates
├── postgres/             # control database data
├── .env                  # generated secrets & config
└── docker-compose.yml    # Traefik + Postgres + panel
\`\`\`

## Verify

\`\`\`bash
cd /etc/supabase-multitenant
docker compose ps
# Traefik, postgres and <product>-panel should all be "running"
\`\`\`

Then open \`http://YOUR_SERVER_IP:3000\` and register the first admin account.

## Upgrade

Rebuild / re-pull the image and restart:

\`\`\`bash
cd /etc/supabase-multitenant
docker compose pull
docker compose up -d
\`\`\`
`

const localDevelopment = `# Local development

You can run the panel locally without the production Docker stack. The only hard dependency is a Postgres database for the control plane.

## Prerequisites

- Node.js 18+
- Docker Desktop (for the local Postgres and for deploying Supabase projects)

## Setup

\`\`\`bash
# 1. Clone and enter the repo
git clone https://github.com/supabase-multitenant/supabase-multitenant.git
cd supabase-multitenant

# 2. Install dependencies
npm install

# 3. Create the environment file
cp .env.example .env

# 4. Start the development Postgres on port 5433
docker compose -f docker-compose.dev.yml up -d

# 5. Generate the Prisma client and push the schema
npm run db:generate
npm run db:push

# 6. Start the dev server
npm run dev
\`\`\`

The dev server runs in **development** mode (\`SUPABASE_MULTITENANT_MODE=development\`), so project and core files are stored under \`./supabase-projects\` and \`./supabase-core\` in the working directory instead of \`/etc/supabase-multitenant\`.

## Useful scripts

| Script | Purpose |
|--------|---------|
| \`npm run dev\` | Start the Next.js dev server with turbopack |
| \`npm run build\` | Production build |
| \`npm test\` | Run the Vitest suite (unit + rebrand checks) |
| \`npm run type-check\` | \`tsc --noEmit\` over the whole project |
| \`npm run db:push\` | Sync the Prisma schema to the database |
| \`npm run db:studio\` | Open Prisma Studio (\`db:studio\`) |
`

const architecture = `# Architecture

Supabase Multitenant is a **control plane** that manages many isolated **data planes**. One infrastructure, many databases.

## Layers

\`\`\`text
                    ┌─────────────────────────────┐
   Host(domain) ──▶ │  Traefik (edge + TLS)       │
                    │  Let's Encrypt, port 80/443 │
                    └───────────┬─────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            │ Control plane     │ Data plane         │
            ▼                   ▼                    ▼
   ┌─────────────────┐   ┌──────────────────────────────┐
   │ Panel (Next.js) │   │ Supabase project stack (×N)  │
   │  :3000          │   │ Kong → PostgREST | Auth |    │
   │  admin + config │   │ Realtime | Storage | Studio  │
   └────────┬────────┘   │ via Supavisor → Postgres     │
            │            └──────────────────────────────┘
            ▼
   ┌─────────────────┐
   │ Control DB      │
   │  PostgreSQL     │
   │  (projects,env) │
   └─────────────────┘
\`\`\`

## The control plane

The **panel** is a Next.js application exposed on \`3000\`. It authenticates administrators, reads/writes project metadata and environment variables in the control **Postgres** database, and orchestrates each project lifecycle. The control database stores user accounts, projects, and their environment variables.

## The data plane

Each project is a full, **isolated** Supabase stack. The panel lays it down under \`projects/<slug>\` by generating a dedicated docker-compose from the cloned Supabase core repository and the environment variables you configure:

- **Kong** — API gateway (default \`KONG_HTTP_PORT=8000\`)
- **PostgREST** — auto-generated REST API
- **GoTrue (Auth)** — authentication
- **Realtime** — websocket/messaging
- **Storage** — object storage
- **Studio** — the Supabase Studio UI (default \`STUDIO_PORT=3000\`)
- **Supavisor + Postgres** — pooled database access

Because every stack runs its own containers and its own Postgres instance, projects cannot see each other.

## Where domain routing lives

Traefik reads dynamic configs from \`traefik/dynamic/*.yml\`. The panel writes one file per project (named by slug) plus a \`panel.yml\` for the panel itself when you configure a custom domain. See [Networking](/docs/networking).
`

const networking = `# Networking & Traefik

Traefik is the single edge for the whole platform: it terminates TLS, routes each hostname to the right service and issues certificates automatically.

## Routing model

Two kinds of routing config are generated:

- **Panel routing** (\`panel.yml\`) — the control plane. When you set a custom domain in **Settings → Custom Domain**, the panel writes a router that points \`https://your-domain\` to \`http://<product>-panel:3000\`.
- **Project routing** — one file per project (\`<slug>.yml\`). It routes the project's API domain to its **Kong** service and an optional Studio domain to its **Studio**.

\`\`\`yaml
http:
  routers:
    myproject-api:
      rule: "Host(\`api.example.com\`)"
      entryPoints: [websecure]
      service: myproject-api
      tls: { certResolver: letsencrypt }
  services:
    myproject-api:
      loadBalancer:
        servers:
          - url: "http://myproject-kong:8000"
\`\`\`

## HTTPS

Certificates are issued by Let's Encrypt using the **TLS-ALPN challenge**. Set the notification email via \`TRAEFIK_ACME_EMAIL\`. Certificates are stored in \`traefik/acme/acme.json\` (kept \`chmod 600\`).

## Ports

| Port | Service |
|------|---------|
| \`80\` | Traefik HTTP → redirects to HTTPS |
| \`443\` | Traefik HTTPS |
| \`3000\` | Panel |
| project-specific | Kong (\`8000\`), Studio (\`3000\`) and others, per project |

## DNS

Point an **A record** for each domain to your server's IP. Traefik's file provider watches \`traefik/dynamic\` and picks the change up automatically — no restart needed.
`

const projects = `# Managing projects

The dashboard lists every Supabase project on the platform. Each project maps to one directory under \`projects/\` and one isolated Supabase stack.

## Create a project

1. Click **New Project**.
2. Enter a **name** and optional description. A unique slug is generated automatically.
3. On the next screen, set the environment variables you need (secrets, ports, URLs).
4. **Save configuration**, then **Deploy**.

The panel generates the project's docker-compose from the environment variables and starts the stack.

## Project lifecycle

| Action | What happens |
|--------|--------------|
| Deploy | Writes \`projects/<slug>/docker-compose.yml\` and runs \`docker compose up -d\` |
| Configure | Updates the project's environment variables in the control database |
| Set domain | Regenerates the project's Traefik routing |
| Delete | Removes the directory, its Traefik config and the project's database records |

## Ports & URLs

You can reach the project from its configured ports regardless of domain. The dashboard shows the gateway and Studio URLs derived from \`KONG_HTTP_PORT\` and \`STUDIO_PORT\`. To serve a clean hostname, see [Custom domains](/docs/custom-domains).
`

const environmentVariables = `# Environment variables

Each project's stack is configured through a set of environment variables stored in the control database and rendered into the generated docker-compose.

## Secrets

| Variable | Purpose |
|----------|---------|
| \`POSTGRES_PASSWORD\` | Project database password |
| \`JWT_SECRET\` | JWT signing secret (≥ 32 chars) |
| \`ANON_KEY\` | Public "anon" JWT |
| \`SERVICE_ROLE_KEY\` | Server-side "service_role" JWT |
| \`SECRET_KEY_BASE\` | Rails-style secret used by the stack |
| \`VAULT_ENC_KEY\` | Encryption key for the vault |

## Service endpoints

| Variable | Default |
|----------|---------|
| \`KONG_HTTP_PORT\` | \`8000\` |
| \`STUDIO_PORT\` | \`3000\` |
| \`POSTGRES_HOST\` | \`db\` |
| \`POSTGRES_PORT\` | \`5432\` |
| \`ANALYTICS_PORT\` | \`4000\` |
| \`POOLER_PROXY_PORT_TRANSACTION\` | \`6543\` |

## URLs & auth

| Variable | Default |
|----------|---------|
| \`SITE_URL\` | \`http://localhost:3000\` |
| \`API_EXTERNAL_URL\` | \`http://localhost:8000\` |
| \`ENABLE_EMAIL_SIGNUP\` | \`true\` |
| \`DISABLE_SIGNUP\` | \`false\` |
| \`JWT_EXPIRY\` | \`3600\` |

## SMTP

For email auth you can point \`SMTP_HOST\`, \`SMTP_PORT\`, \`SMTP_USER\`, \`SMTP_PASS\` and \`SMTP_SENDER_NAME\` at your mail server. Without it, \`ENABLE_EMAIL_AUTOCONFIRM\` can be set to \`true\` to auto-confirm users.

> Production tip: always generate long, random values for every secret and store them somewhere safe. The panel only writes them into the project's docker-compose.
`

const customDomains = `# Custom domains

Each project can be served from its own hostname(s), and the panel itself can be reached on a branded domain.

## Panel domain

In **Settings → Custom Domain**:

1. Point an **A record** for \`panel.example.com\` to your server's IP.
2. Enter the domain and save. The panel writes \`traefik/dynamic/panel.yml\` routing \`https://panel.example.com\` to the panel.
3. Set \`TRAEFIK_ACME_EMAIL\` so Let's Encrypt can notify you about expiry.

## Project API + Studio domains

On a project's **Domain** settings you can set:

- **API domain** (default points at the project's **Kong** service)
- **Studio domain** (optional, points at the project's **Studio**)

Both generate a per-project Traefik dynamic config. The panel also runs a basic DNS check to confirm the hostname resolves before applying it.

## Verification

\`\`\`bash
curl -I https://api.example.com   # expect HTTP 200 from Kong
curl -I https://studio.example.com
\`\`\`

Certificates are issued automatically on first request. If DNS isn't propagated yet, allow a few minutes and retry.
`

const deployments = `# Deployments

A project deployment brings its Supabase stack up (or updates it) from the stored configuration.

## How deployment works

The panel:

1. Renders \`projects/<slug>/docker-compose.yml\` from the project's environment variables (ports, secrets, URLs).
2. Runs \`docker compose up -d\` in that directory.
3. Reports success or the container logs.

That's it — the whole stack is just Docker. There's no background agent or worker required.

## Re-deploy after config changes

After editing environment variables, click **Deploy** again on the project page. Changes to ports or image settings require a re-deploy to take effect.

## Pre-flight checks

Before deploying, the panel checks whether Docker and Docker Compose are available and tests internet connectivity (so it can pull images if they aren't cached). If there's no internet but images are already present, it will still proceed with the cached images.

## Watching a deployment

\`\`\`bash
cd projects/<slug>
docker compose logs -f
\`\`\`

## Idempotency

Deployment is idempotent: running it again with the same config is a no-op for containers already at the right state.
`

const authentication = `# Authentication & teams

Access to the panel is controlled by an administrator account and a session cookie.

## First-user admin

When the control database has **no users**, the panel opens registration. The very first account you register becomes the administrator and registration is then closed. This is a deliberate guard so a freshly installed platform isn't left open.

## Login

Login uses NextAuth with a username/email and a bcrypt-hashed password. The session is held in a cookie signed with \`NEXTAUTH_SECRET\`.

## Invites

Administrators can invite team members. An invite email (sent through \`nodemailer\` using your \`SMTP_*\` settings) contains a link to accept and join the team on the platform.

## Environment variables used

| Variable | Purpose |
|----------|---------|
| \`NEXTAUTH_SECRET\` | Signs the session cookie |
| \`NEXTAUTH_URL\` | Panel base URL |
| \`APP_NAME\` | Shown in email subjects & the dashboard |
| \`SMTP_HOST\` / \`SMTP_PORT\` | Outbound mail server |
| \`SMTP_USER\` / \`SMTP_PASS\` | Mail credentials |

## Reset password

A "forgot password" flow emails a one-hour reset link to the address on file. The reset URL points at \`APP_URL/auth/reset-password\`.
`

const configuration = `# Configuration reference

All settings for the control plane live in environment variables.

## Mode

| Variable | Values | Default |
|----------|--------|---------|
| \`SUPABASE_MULTITENANT_MODE\` | \`development\` / \`production\` | \`development\` |

In \`production\` (Docker) mode the panel stores data under \`DATA_PATH\` (default \`/etc/supabase-multitenant\`). In \`development\` mode it uses \`./supabase-core\` and \`./supabase-projects\` relative to the working directory.

## Database

| Variable | Description |
|----------|-------------|
| \`DATABASE_URL\` | Control-plane Postgres connection string |

Example: \`postgresql://supabase_multitenant:<pass>@postgres:5432/supabase_multitenant\`

## Auth

| Variable | Description |
|----------|-------------|
| \`NEXTAUTH_SECRET\` | Session signing secret (auto-generated by the installer) |
| \`NEXTAUTH_URL\` | Panel base URL, e.g. \`http://localhost:3000\` |

## SMTP (optional)

\`SMTP_HOST\`, \`SMTP_PORT\`, \`SMTP_SECURE\`, \`SMTP_USER\`, \`SMTP_PASS\`

## Supabase core

| Variable | Description |
|----------|-------------|
| \`SUPABASE_CORE_REPO_URL\` | Repo cloned on **Initialize** (default \`https://github.com/supabase/supabase\`) |

## Traefik / data paths

| Variable | Description |
|----------|-------------|
| \`TRAEFIK_ACME_EMAIL\` | Let's Encrypt notification email |
| \`DATA_PATH\` | Production data root (default \`/etc/supabase-multitenant\`) |
| \`APP_NAME\` | Display name used in emails and the panel |
| \`APP_URL\` | Public base URL of the panel |
`

const api = `# API reference

The panel exposes a small JSON API (Next.js route handlers) that the dashboard calls. It's also useful for scripting your own workflows.

> All endpoints below are bearer-protected by the admin session cookie unless noted. Responses are JSON.

## System

| Method | Path | Description |
|--------|------|-------------|
| \`GET\` | \`/api/health\` | Liveness probe (public) |
| \`GET\` | \`/api/system/check\` | Docker, Docker Compose & internet pre-flight |
| \`GET\` | \`/api/system/metrics\` | Host/metrics summary |

## Auth

| Method | Path | Description |
|--------|------|-------------|
| \`GET\` | \`/api/auth/registration-status\` | Whether registration is still open |
| \`POST\` | \`/api/auth/register\` | Register the first admin |
| \`POST\` | \`/api/auth/login\` | Sign in |
| \`POST\` | \`/api/auth/logout\` | Sign out |

## Projects

| Method | Path | Description |
|--------|------|-------------|
| \`GET\` / \`POST\` | \`/api/projects\` | List / create projects |
| \`GET\` / \`DELETE\` | \`/api/projects/:id\` | Read / delete a project |
| \`POST\` | \`/api/projects/initialize\` | Clone the Supabase core repo |
| \`POST\` | \`/api/projects/:id/deploy\` | Deploy (or update) the project stack |
| \`GET\` / \`PUT\` | \`/api/projects/:id/env\` | Read / update environment variables |
| \`PUT\` | \`/api/projects/:id/domain\` | Set the project's API / Studio domains |

## Settings

| Method | Path | Description |
|--------|------|-------------|
| \`GET\` / \`PUT\` / \`DELETE\` | \`/api/settings/panel-domain\` | Manage the panel custom domain |

## Example

\`\`\`bash
curl -X POST http://localhost:3000/api/projects \\
  -H "Content-Type: application/json" \\
  -H "Cookie: <session>" \\
  -d '{"name":"My App","description":"Prod"}'
\`\`\`
`

const troubleshooting = `# Troubleshooting

Common problems and how to fix them.

## Panel container won't start

\`\`\`bash
docker logs supabase-multitenant-panel
\`\`\`

Look for a missing \`DATABASE_URL\`. The entrypoint also runs \`prisma db push\` on startup, so a slow/absent database will block startup — confirm the Postgres container is healthy first.

## PostgreSQL connection error

\`\`\`bash
docker ps | grep postgres
docker logs supabase-multitenant-postgres
\`\`\`

Ensure the database user and database exist and that the connection string matches:

\`\`\`bash
docker exec supabase-multitenant-panel npx prisma db push
\`\`\`

## Tables missing / schema out of date

Rerun the Prisma sync:

\`\`\`bash
docker exec supabase-multitenant-panel npx prisma db push
\`\`\`

## Docker socket permission denied

The panel needs access to the host Docker socket. Grant the required permission:

\`\`\`bash
chmod 666 /var/run/docker.sock
\`\`\`

## Let's Encrypt cert not issuing

- Confirm the **A record** points to this server and DNS has propagated.
- Confirm ports **80** and **443** are reachable from the internet.
- Make sure \`TRAEFIK_ACME_EMAIL\` is set to a valid email.

## Can't register after the first admin

By design, only the first account self-registers. Subsequent access requires an administrator login (or an invite).
`

const faq = `# FAQ

## What is Supabase Multitenant?

An open-source control plane that lets you run many isolated Supabase databases on one server (or any host) behind a unified dashboard. Think of it as running your own Supabase.com-style cloud on infrastructure you control.

## Is it free?

Yes — it's MIT-licensed open source. You pay only for the infrastructure you run it on.

## Where can it run?

Any Linux host with Docker: a VPS, Coolify, Dokku, Dokploy, nomad nodes, or bare metal. The only hard requirements are Docker, ports 80/443/3000 and root during install.

## Are projects truly isolated?

Yes. Every project is its own stack with its own Postgres, API (Kong), Auth, Studio, Storage, Realtime and connection pooler. Projects have no shared state.

## How is it different from running one Supabase per server?

You get a single dashboard and a single Postgres (control plane) to manage many projects, plus automatic Traefik routing and TLS. You stop hand-running \`docker compose up\` for every project.

## Can I use my existing Supabase project?

Each project stack is generated from the cloned \`supabase/supabase\` core repo and its own env vars. You can point a project at your existing data by adjusting the environment variables.

## Do I need a domain?

Not to start — you can reach the panel via the server IP on port 3000. A domain (and DNS) is only needed to enable HTTPS and clean custom hostnames.

## How do I upgrade?

Pull the new image and restart the stack (\`docker compose pull && docker compose up -d\`). Project stacks are unaffected.

## Where's the source?

The repo lives at \`github.com/supabase-multitenant/supabase-multitenant\`. Contributions are welcome.
`

export const PAGES: DocPage[] = [
  { slug: 'introduction', group: 'getting-started', title: 'Introduction', description: 'What Supabase Multitenant is and the problem it solves.', content: introduction },
  { slug: 'quick-start', group: 'getting-started', title: 'Quick start', description: 'Get a running platform in a few minutes.', content: quickStart },
  { slug: 'installation', group: 'getting-started', title: 'Installation', description: 'Install on a fresh Linux server.', content: installation },
  { slug: 'local-development', group: 'getting-started', title: 'Local development', description: 'Run the panel locally for development.', content: localDevelopment },

  { slug: 'architecture', group: 'architecture', title: 'Architecture', description: 'The control plane and isolated data planes.', content: architecture },
  { slug: 'networking', group: 'architecture', title: 'Networking & Traefik', description: 'Routing, TLS and ports.', content: networking },

  { slug: 'projects', group: 'management', title: 'Managing projects', description: 'Create, deploy and remove Supabase projects.', content: projects },
  { slug: 'environment-variables', group: 'management', title: 'Environment variables', description: 'Every variable a project stack accepts.', content: environmentVariables },
  { slug: 'custom-domains', group: 'management', title: 'Custom domains', description: 'Branded domains for the panel and projects.', content: customDomains },
  { slug: 'deployments', group: 'management', title: 'Deployments', description: 'How a project stack is brought up and updated.', content: deployments },

  { slug: 'authentication', group: 'platform', title: 'Authentication & teams', description: 'Admin auth, invites and sessions.', content: authentication },
  { slug: 'configuration', group: 'platform', title: 'Configuration reference', description: 'All control-plane environment variables.', content: configuration },
  { slug: 'api', group: 'platform', title: 'API reference', description: 'The HTTP API the dashboard uses.', content: api },
  { slug: 'troubleshooting', group: 'platform', title: 'Troubleshooting', description: 'Fix common deployment and network issues.', content: troubleshooting },
  { slug: 'faq', group: 'platform', title: 'FAQ', description: 'Frequently asked questions.', content: faq },
]

export const PAGE_BY_SLUG = new Map(PAGES.map((p) => [p.slug, p]))

export const FIRST_PAGE_SLUG = NAV[0].items[0]

export function groupLabel(groupId: string): string {
  return NAV.find((g) => g.id === groupId)?.label ?? groupId
}

export function docLinks(): { slug: string; title: string; group: string; groupLabel: string }[] {
  const items: { slug: string; title: string; group: string; groupLabel: string }[] = []
  for (const group of NAV) {
    for (const slug of group.items) {
      const page = PAGE_BY_SLUG.get(slug)
      if (page) items.push({ slug, title: page.title, group: page.group, groupLabel: group.label })
    }
  }
  return items
}
