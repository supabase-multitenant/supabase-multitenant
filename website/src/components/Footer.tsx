import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { LICENSE_URL, REPO_URL } from '../lib/site'

const COLUMNS: { title: string; links: { label: string; to?: string; href?: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Home', to: '/' },
      { label: 'How it works', to: '/how-it-works' },
      { label: 'Docs', to: '/docs/introduction' },
    ],
  },
  {
    title: 'Docs',
    links: [
      { label: 'Introduction', to: '/docs/introduction' },
      { label: 'Quick start', to: '/docs/quick-start' },
      { label: 'Installation', to: '/docs/installation' },
      { label: 'Architecture', to: '/docs/architecture' },
      { label: 'FAQ', to: '/docs/faq' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'GitHub', href: REPO_URL },
      { label: 'License', href: LICENSE_URL },
      { label: 'Supabase', href: 'https://supabase.com' },
      { label: 'Traefik', href: 'https://traefik.io' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface-950">
      <div className="shell py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <span className="font-display font-extrabold tracking-tight text-white">
                supabase
                <span className="text-brand-400">/</span>
                <span className="text-brand-400">multitenant</span>
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              Self-host Supabase as your own Supabase.com-style cloud. One
              infrastructure, many isolated databases — run anywhere you choose.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold text-white">{col.title}</h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href ? (
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-muted transition-colors hover:text-white"
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link
                        to={l.to!}
                        className="text-sm text-muted transition-colors hover:text-white"
                      >
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-line pt-8 text-sm text-dim md:flex-row">
          <p>© {new Date().getFullYear()} Supabase Multitenant · MIT licensed</p>
          <p className="flex items-center gap-1.5">
            Built with Next.js-style control planes
            <span className="text-brand-400">●</span> Postgres
            <span className="text-brand-400">●</span> Traefik
            <span className="text-brand-400">●</span> Docker
          </p>
        </div>
      </div>
    </footer>
  )
}
