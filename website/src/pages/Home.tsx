import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArchDiagram } from '../components/ArchDiagram'
import { INSTALL_URL } from '../lib/site'

const FEATURES = [
  { title: 'One-command install', body: 'A single curl | sh brings up Traefik, the control Postgres and the panel on any fresh Linux server.' },
  { title: 'True isolation', body: 'Every project is its own Supabase stack and its own database — no shared state, no cross-project access.' },
  { title: 'Automatic HTTPS', body: 'Traefik issues and renews Let’s Encrypt certificates for the panel and every project domain.' },
  { title: 'One dashboard', body: 'Create, configure, deploy and monitor every project from a single, self-hosted control plane.' },
  { title: 'Custom domains', body: 'Give each project its own API and Studio hostname, plus a branded domain for the panel itself.' },
  { title: 'Team access', body: 'First-user administrator, session auth and invites — you decide who can manage the platform.' },
]

const STEPS = [
  { n: '01', title: 'Install', body: 'Run the installer on a fresh server. It provisions Docker, writes /etc/supabase-multitenant and starts the stack.' },
  { n: '02', title: 'Initialize & create', body: 'Initialize the Supabase core repo once, then create as many projects as you need from the dashboard.' },
  { n: '03', title: 'Deploy & route', body: 'For each project the panel writes a docker-compose and Traefik routes its domain automatically.' },
]

const TARGETS = ['VPS', 'Coolify', 'Dokku', 'Dokploy', 'Bare metal', 'Nomad']

export function Home() {
  useEffect(() => {
    document.title = 'Supabase Multitenant — Self-host Supabase, your way'
  }, [])

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(60% 60% at 50% -5%, rgba(62,207,142,0.22) 0%, rgba(62,207,142,0) 60%)',
          }}
        />
        <div className="shell pt-24 pb-20 text-center sm:pt-32">
          <span className="chip mx-auto">Open source · MIT · self-host anywhere</span>
          <h1 className="mx-auto mt-6 max-w-4xl font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl md:text-7xl">
            Self-host Supabase
            <br />
            as your <span className="text-brand-400">own cloud</span>.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            One platform. Many isolated Supabase databases. Deploy on any VPS, Coolify,
            Dokku, Dokploy, or your own infrastructure — and manage everything from a single dashboard.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/docs/installation"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-400 px-6 py-3 text-sm font-semibold text-surface-950 transition-colors hover:bg-brand-300 sm:w-auto"
            >
              Get started
            </Link>
            <Link
              to="/docs/introduction"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-line px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/5 sm:w-auto"
            >
              Read the docs
            </Link>
          </div>

          {/* Terminal */}
          <div className="mx-auto mt-14 max-w-2xl overflow-hidden rounded-xl border border-line bg-[#080808] text-left shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              <span className="ml-3 text-xs text-dim">install.sh</span>
            </div>
            <pre className="p-5 font-mono text-[13px] leading-relaxed">
              <span className="text-brand-400">$</span> <span className="text-white">curl -sSL {INSTALL_URL} | sh</span>
              {'\n'}
              <span className="text-dim">→ installing Docker…</span>
              {'\n'}
              <span className="text-dim">→ writing /etc/supabase-multitenant/.env</span>
              {'\n'}
              <span className="text-dim">→ starting traefik · postgres · panel</span>
              {'\n'}
              <span className="text-brand-400">✓ Supabase Multitenant is live at http://YOUR_IP:3000</span>
              <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-brand-400 align-middle" />
            </pre>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-line bg-surface-950/60">
        <div className="shell flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-8">
          <span className="text-xs font-medium uppercase tracking-widest text-dim">Deploy anywhere</span>
          {TARGETS.map((t) => (
            <span key={t} className="font-display text-lg font-bold text-white/70">
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="shell py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Everything you need to run your own Supabase cloud
          </h2>
          <p className="mt-4 text-lg text-muted">
            Stop hand-running docker-compose per project. One panel manages them all.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card card-hover p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-brand-400/30 bg-brand-400/10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3ECF8E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              </div>
              <h3 className="font-display text-lg font-bold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-line bg-surface-950/40">
        <div className="shell py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              How it works
            </h2>
            <p className="mt-4 text-lg text-muted">
              A control plane that orchestrates isolated data planes.
            </p>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="card p-6">
                <span className="font-display text-sm font-bold text-brand-400">{s.n}</span>
                <h3 className="mt-3 font-display text-xl font-bold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-16">
            <ArchDiagram />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="shell py-24">
        <div className="card relative overflow-hidden p-10 text-center sm:p-16">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgba(62,207,142,0.18) 0%, rgba(62,207,142,0) 70%)' }}
          />
          <h2 className="relative font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Your own Supabase cloud is one command away
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-lg text-muted">
            Deploy on a fresh server, register the first admin, and create your first isolated Supabase project.
          </p>
          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/docs/installation"
              className="inline-flex items-center justify-center rounded-lg bg-brand-400 px-6 py-3 text-sm font-semibold text-surface-950 transition-colors hover:bg-brand-300"
            >
              Get started
            </Link>
            <Link
              to="/how-it-works"
              className="inline-flex items-center justify-center rounded-lg border border-line px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/5"
            >
              Explore the architecture
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
