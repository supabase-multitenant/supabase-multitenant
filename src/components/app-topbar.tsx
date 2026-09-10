'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { HelpCircle, Search } from 'lucide-react'
import { BrandMark } from './brand'
import { ThemeToggle } from './theme-toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type Crumb = { label: string; href?: string; badge?: string }

export type TopbarUser = { email?: string | null; name?: string | null; role?: string }

function initials(user?: TopbarUser) {
  const source = user?.name || user?.email || '?'
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')
}

export function AppTopbar({ crumbs, user }: { crumbs: Crumb[]; user?: TopbarUser }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="flex h-12 items-center gap-2 px-4">
        <Link href="/" aria-label="Home">
          <BrandMark className="h-5 w-5" />
        </Link>
        {crumbs.map((c) => (
          <Fragment key={c.label}>
            <span className="text-border">/</span>
            {c.href ? (
              <Link
                href={c.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {c.label}
              </Link>
            ) : (
              <span className="text-sm text-foreground">{c.label}</span>
            )}
            {c.badge ? (
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {c.badge}
              </span>
            ) : null}
          </Fragment>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/dashboard/settings"
            className="hidden cursor-pointer text-sm text-muted-foreground hover:text-foreground sm:inline"
          >
            Feedback
          </Link>
          <div className="hidden items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground md:flex">
            <Search className="h-3.5 w-3.5" />
            <span>Search...</span>
            <kbd className="ml-6 font-mono text-[11px]">⌘K</kbd>
          </div>
          <ThemeToggle />
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground">
            <HelpCircle className="h-4 w-4" />
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger className="h-8 w-8 rounded-full bg-gradient-to-br from-brand to-brand-strong text-xs font-semibold text-brand-foreground">
              {initials(user) || 'AM'}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="font-normal text-muted-foreground">
                {user?.email ?? 'not signed in'}
                {user?.role ? (
                  <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase">
                    {user.role}
                  </span>
                ) : null}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">Account</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">Feature previews</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/docs">Changelog</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => signOut({ callbackUrl: '/auth/login' })}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
