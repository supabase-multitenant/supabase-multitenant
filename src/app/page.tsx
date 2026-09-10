import Link from 'next/link'
import { ArrowRight, Boxes, Building2, Check, Database, HardDrive, Lock, Radio, Zap } from 'lucide-react'
import { SiteHeader } from '@/components/site-header'
import { BrandMark } from '@/components/brand'

export const metadata = {
  title: 'Supabase Multitenant — Postgres for every team and every project',
  description:
    'Spin up organizations, invite your team and give each project a dedicated Postgres database with auth, storage, realtime and edge functions.',
}

const features = [
  {
    icon: Database,
    title: 'Postgres database',
    body: 'Every project gets a dedicated Postgres instance with extensions, backups and branching.',
    points: ['100% portable', 'Row Level Security', 'Point-in-time recovery'],
    wide: true,
  },
  {
    icon: Lock,
    title: 'Authentication',
    body: 'Email, OAuth and SSO logins wired to your tables through row level policies.',
  },
  {
    icon: Zap,
    title: 'Edge functions',
    body: 'Deploy TypeScript functions close to your users without managing servers.',
  },
  {
    icon: HardDrive,
    title: 'Storage',
    body: 'Store and serve large files with resumable uploads and image transforms.',
  },
  {
    icon: Radio,
    title: 'Realtime',
    body: 'Broadcast, presence and database changes streamed over websockets.',
  },
  {
    icon: Boxes,
    title: 'Vector',
    body: 'Store embeddings next to your rows and query them with plain SQL.',
  },
  {
    icon: Building2,
    title: 'Multitenancy',
    body: 'Organizations, roles and per-project isolation built in from day one.',
  },
]

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-5 py-24 lg:grid-cols-[1.15fr_1fr] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                Self-hosted · one stack per project
              </span>
              <h1 className="mt-6 text-5xl font-semibold leading-[1.05] text-foreground sm:text-6xl">
                Ship on Friday.
                <br />
                <span className="brand-gradient-text">Scale on Monday.</span>
              </h1>
              <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
                Group your work into organizations, give every project its own Postgres database,
                and add auth, storage, realtime and functions when you need them.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/organizations"
                  className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
                >
                  Start your project <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/auth/login"
                  className="rounded-md border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Sign in
                </Link>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-1 shadow-2xl shadow-black/10">
              <div className="flex items-center gap-2 px-3 py-2">
                <BrandMark className="h-4 w-4" />
                <span className="text-xs text-muted-foreground">sql editor</span>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 font-mono text-[12.5px] leading-6 text-muted-foreground">
                <code>{`create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs (id),
  name text not null,
  region text default 'eu-central-1'
);

alter table projects enable row level security;

create policy "members read own org projects"
  on projects for select
  using (org_id = auth.org_id());`}</code>
              </pre>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-2xl font-semibold text-foreground">Everything in one workspace</h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Use the whole platform or just the pieces you need. Each one is a standalone product
            that works with the rest.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <article
                key={f.title}
                className={`group relative overflow-hidden rounded-xl border border-border bg-surface p-6 transition-colors hover:border-brand/50 ${
                  f.wide ? 'lg:col-span-2 lg:row-span-2' : ''
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <f.icon className="h-4 w-4 text-brand" />
                  <h3 className="text-[15px] font-medium text-foreground">{f.title}</h3>
                </div>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
                {f.points ? (
                  <ul className="mt-6 space-y-2">
                    {f.points.map((p) => (
                      <li key={p} className="flex items-center gap-2 text-sm text-foreground">
                        <Check className="h-3.5 w-3.5 text-brand" /> {p}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {f.wide ? (
                  <div className="grid-bg mt-8 h-40 rounded-lg border border-border opacity-60" />
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-16 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">
                Start with a free organization
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Two projects, 500 MB database and unlimited API requests. No card needed.
              </p>
            </div>
            <Link
              href="/organizations"
              className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
            >
              Create organization
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-5 py-10 text-sm text-muted-foreground">
        © 2026 Supabase Multitenant — self-hosted Supabase, one isolated stack per project.
      </footer>
    </div>
  )
}
