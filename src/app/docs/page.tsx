import Image from 'next/image'
import Link from 'next/link'

export const metadata = {
  title: 'Supabase Multitenant — Docs & Demo',
  description:
    'Self-host Supabase as your own Supabase.com-style cloud. One infrastructure, many isolated databases, with scalable multitenancy.',
}

const features = [
  { title: 'One-Command Install', desc: 'Deploy on any Linux server with a single script.' },
  { title: 'Docker Integration', desc: 'Automated Docker Compose deployment per project.' },
  { title: 'Traefik Reverse Proxy', desc: 'Automatic HTTPS with Let\u2019s Encrypt certificates.' },
  { title: 'Secure Registration', desc: 'First-user-only admin registration.' },
  { title: 'Environment Config', desc: 'Web UI for managing project environment variables.' },
  { title: 'Custom Domains', desc: 'Assign unique domains to each Supabase project.' },
  { title: 'Team Management', desc: 'User authentication and team access control.' },
  { title: 'Modern Interface', desc: 'Dark, responsive design built with shadcn/ui.' },
]

const stack: Array<[string, string]> = [
  ['Frontend', 'Next.js 15 \u00b7 TypeScript \u00b7 Tailwind \u00b7 shadcn/ui'],
  ['Backend', 'Next.js API Routes \u00b7 Prisma ORM'],
  ['Database', 'PostgreSQL'],
  ['Proxy', 'Traefik v3 \u00b7 Let\u2019s Encrypt'],
  ['Container', 'Docker \u00b7 Docker Compose'],
]

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/supabase-multitenant-logo-transparent.png"
              alt="Supabase Multitenant"
              width={36}
              height={36}
              className="object-contain"
            />
            <span className="font-semibold tracking-tight">Supabase Multitenant</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <a
              href="https://supabase-multitenant.github.io"
              className="text-muted-foreground hover:text-foreground"
            >
              Website
            </a>
            <a
              href="https://github.com/supabase-multitenant/supabase-multitenant"
              className="text-muted-foreground hover:text-foreground"
            >
              GitHub
            </a>
            <Link
              href="/"
              className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90"
            >
              Open App
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="container mx-auto px-4 py-20 text-center">
          <Image
            src="/supabase-multitenant-logo-transparent.png"
            alt="Supabase Multitenant Logo"
            width={104}
            height={104}
            className="mx-auto mb-6 object-contain"
            priority
          />
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Supabase Multitenant</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Self-host Supabase as your own Supabase.com-style cloud \u2014 one infrastructure, many
            isolated databases, with scalable multitenancy.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="rounded-md bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-500"
            >
              Get Started
            </Link>
            <a
              href="https://github.com/supabase-multitenant/supabase-multitenant"
              className="rounded-md border border-zinc-700 px-5 py-2.5 font-medium text-zinc-200 hover:bg-zinc-800"
            >
              GitHub
            </a>
          </div>
        </section>

        {/* Demo screenshot */}
        <section className="container mx-auto px-4 pb-20">
          <div className="mx-auto max-w-5xl">
            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-card p-2 shadow-2xl shadow-black/40">
              <Image
                src="/demo_page_dashboard-smt.png"
                alt="Supabase Multitenant dashboard demo"
                width={1519}
                height={947}
                priority
                sizes="(max-width: 1024px) 100vw, 1024px"
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Dashboard \u2014 manage many isolated Supabase projects from one panel.
            </p>
          </div>
        </section>

        {/* Features */}
        <section className="container mx-auto px-4 py-20">
          <h2 className="text-center text-2xl font-bold">Features</h2>
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div key={f.title} className="rounded-lg border bg-card p-5">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Tech stack */}
        <section className="container mx-auto px-4 py-20">
          <h2 className="text-center text-2xl font-bold">Tech Stack</h2>
          <div className="mx-auto mt-8 max-w-2xl divide-y rounded-lg border">
            {stack.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-5 py-3">
                <span className="font-medium">{k}</span>
                <span className="text-sm text-muted-foreground">{v}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="container mx-auto px-4 py-8 text-center text-sm text-muted-foreground">
          <p>Self-host Supabase \u2014 your own Supabase-style cloud.</p>
          <p className="mt-2">
            <a
              href="https://supabase-multitenant.github.io"
              className="hover:text-foreground"
            >
              Website
            </a>{' '}\u00b7{' '}
            <a
              href="https://github.com/supabase-multitenant/supabase-multitenant"
              className="hover:text-foreground"
            >
              GitHub
            </a>{' '}\u00b7{' '}
            <Link href="/" className="hover:text-foreground">
              Open App
            </Link>
          </p>
        </div>
      </footer>
    </div>
  )
}
