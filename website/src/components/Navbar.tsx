import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Logo } from './Logo'
import { REPO_URL } from '../lib/site'

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/docs/introduction', label: 'Docs' },
]

export function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface-900/80 backdrop-blur-xl">
      <div className="shell flex h-16 items-center justify-between">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'text-white' : 'text-muted hover:text-white'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-white"
          >
            GitHub
          </a>
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            to="/docs/installation"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-400 px-4 py-2 text-sm font-semibold text-surface-950 transition-colors hover:bg-brand-300"
          >
            Get started
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line text-muted md:hidden"
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <nav className="shell flex flex-col gap-1 border-t border-line py-3 md:hidden">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2.5 text-sm font-medium ${
                  isActive ? 'text-white' : 'text-muted'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted"
          >
            GitHub
          </a>
          <Link
            to="/docs/installation"
            onClick={() => setOpen(false)}
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-brand-400 px-4 py-2.5 text-sm font-semibold text-surface-950"
          >
            Get started
          </Link>
        </nav>
      )}
    </header>
  )
}
