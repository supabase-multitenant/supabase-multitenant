import Link from 'next/link'
import { Github } from 'lucide-react'
import { BrandLogo } from './brand'
import { ThemeToggle } from './theme-toggle'

const nav = ['Product', 'Developers', 'Solutions', 'Pricing', 'Docs', 'Blog']

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-5">
        <BrandLogo />
        <nav className="hidden items-center gap-6 md:flex">
          {nav.map((item) => (
            <span
              key={item}
              className="cursor-default text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item}
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Github className="h-4 w-4" />
          </span>
          <ThemeToggle />
          <Link
            href="/auth/login"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/organizations"
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
          >
            Start your project
          </Link>
        </div>
      </div>
    </header>
  )
}
