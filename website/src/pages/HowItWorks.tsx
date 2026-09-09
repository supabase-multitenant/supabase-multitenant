import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArchDiagram } from '../components/ArchDiagram'

const LIFECYCLE = [
  { title: 'Provision a server', body: 'Any Linux host with Docker and ports 80/443/3000 free — a VPS, Coolify, Dokku, Dokploy or your own hardware.' },
  { title: 'Run the installer', body: 'curl | sh sets up Docker (if needed), the data directory, .env, and a docker-compose with Traefik + Postgres + the panel.' },
  { title: 'Register the admin', body: 'Open http://YOUR_IP:3000 and create the first account. It becomes the administrator; registration then closes.' },
  { title: 'Initialize Supabase core', body: 'The panel clones the supabase/supabase repo into core/ — the source for every project stack.' },
  { title: 'Create a project', body: 'Name it, set its environment variables (secrets, ports, URLs), and save the configuration.' },
  { title: 'Deploy', body: 'The panel renders projects/<slug>/docker-compose.yml and runs docker compose up -d, bringing up that isolated stack.' },
  { title: 'Wire a domain', body: 'Point an A record at your server and set the project’s API / Studio domains. Traefik writes the routing config automatically.' },
  { title: 'Manage & scale', body: 'Every project is independent, so you can deploy, reconfigure or tear down each one without touching the others.' },
]

const REQUEST_FLOW = [
  { step: '1', label: 'Request arrives', body: 'A user hits https://api.myproject.com — TLS is terminated and the Host header is matched.' },
  { step: '2', label: 'Traefik routes it', body: 'The generated config maps that hostname to the project’s Kong service: http://<slug>-kong:<port>.' },
  { step: '3', label: 'Inside the project', body: 'Kong dispatches to PostgREST, Auth, Realtime or Storage within that project’s own network.' },
  { step: '4', label: 'Pooled database', body: 'Data access goes through Supavisor to the project’s isolated Postgres — never to another project’s data.' },
]

export function HowItWorks() {
  useEffect(() => {
    document.title = 'How it works · Supabase Multitenant'
  }, [])

  return (
    <>
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: 'radial-gradient(50% 50% at 50% -5%, rgba(62,207,142,0.18) 0%, rgba(62,207,142,0) 60%)' }}
        />
        <div className="shell pt-20 pb-16 text-center">
          <span className="chip mx-auto">Architecture</span>
          <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            One infrastructure.<br />Many isolated databases.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            Supabase Multitenant splits the world into a single <strong className="text-white">control plane</strong> and many
            isolated <strong className="text-white">data planes</strong> — one panel, one shared Postgres for metadata, and a
            fully independent Supabase stack per project.
          </p>
        </div>
      </section>

      {/* Diagram + explanation */}
      <section className="shell pb-24">
        <ArchDiagram detailed />

        <div className="mx-auto mt-14 grid max-w-5xl gap-8 md:grid-cols-3">
          <div>
            <h3 className="font-display text-lg font-bold text-brand-300">Control plane</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The panel (Next.js on port 3000) is where you log in and manage everything. It stores users, projects and
              environment variables in a single control Postgres, and writes the Traefik routing and per-project Docker
              configs that make everything work.
            </p>
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-brand-300">Data plane</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Every project is an isolated Supabase stack: Kong, PostgREST, GoTrue (Auth), Realtime, Storage, Studio and
              Supavisor, all backed by that project’s own Postgres. Projects cannot see each other.
            </p>
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-brand-300">Edge</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Traefik sits in front of everything. It issues Let’s Encrypt certificates, terminates TLS and routes each
              hostname to the correct panel or project service — no manual proxy configuration per project.
            </p>
          </div>
        </div>
      </section>

      {/* Lifecycle */}
      <section className="border-y border-line bg-surface-950/40">
        <div className="shell py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              From a blank server to a running platform
            </h2>
          </div>

          <ol className="mx-auto mt-14 max-w-3xl space-y-0">
            {LIFECYCLE.map((s, i) => (
              <li key={s.title} className="relative flex gap-5 pb-8 last:pb-0">
                <div className="flex flex-col items-center">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-400/40 bg-brand-400/10 font-display text-sm font-bold text-brand-300">
                    {i + 1}
                  </span>
                  {i < LIFECYCLE.length - 1 && <span className="mt-2 w-px flex-1 bg-line" />}
                </div>
                <div className="pt-1">
                  <h3 className="font-display text-base font-bold text-white">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Request flow */}
      <section className="shell py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            How a request finds its project
          </h2>
          <p className="mt-4 text-lg text-muted">
            Routing is entirely declarative — there’s nothing to wire up per project.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-4xl gap-4 md:grid-cols-2">
          {REQUEST_FLOW.map((s) => (
            <div key={s.step} className="card p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-400/10 font-display text-sm font-bold text-brand-300">
                  {s.step}
                </span>
                <h3 className="font-display text-base font-bold text-white">{s.label}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/docs/installation"
            className="inline-flex items-center justify-center rounded-lg bg-brand-400 px-6 py-3 text-sm font-semibold text-surface-950 transition-colors hover:bg-brand-300"
          >
            Get started
          </Link>
          <Link
            to="/docs/architecture"
            className="inline-flex items-center justify-center rounded-lg border border-line px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/5"
          >
            Read the architecture docs
          </Link>
        </div>
      </section>
    </>
  )
}
