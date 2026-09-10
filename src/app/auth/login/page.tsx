'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { BookOpen, Eye, EyeOff, Github, KeyRound, Sparkles } from 'lucide-react'
import { BrandLogo } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const router = useRouter()

  // First run (no users yet) -> send the operator to the setup/register screen.
  useEffect(() => {
    async function checkSetupStatus() {
      try {
        const response = await fetch('/api/auth/registration-status')
        const data = await response.json()
        if (data.registrationOpen) {
          router.push('/auth/register')
          return
        }
      } catch {
        // show login anyway
      } finally {
        setChecking(false)
      }
    }
    checkSetupStatus()
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await signIn('credentials', { email, password, redirect: false })
      if (result?.error) {
        setError('Invalid email or password')
      } else {
        const next =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('next')
            : null
        router.push(next && next.startsWith('/') ? next : '/organizations')
        router.refresh()
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const oauth = [
    { icon: Github, label: 'Continue with GitHub', enabled: true, onClick: () => signIn('github') },
    { icon: Sparkles, label: 'Continue with Google', enabled: false },
    { icon: KeyRound, label: 'Continue with SSO', enabled: false },
  ]

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <div className="relative flex flex-col px-6 py-6 sm:px-14">
        <BrandLogo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your account</p>

          <div className="mt-8 space-y-2.5">
            {oauth.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={!p.enabled}
                onClick={p.onClick}
                title={p.enabled ? undefined : 'Not configured yet'}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-surface py-2.5 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <p.icon className="h-4 w-4" /> {p.label}
              </button>
            ))}
          </div>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div>
              <label htmlFor="email" className="text-xs font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1.5 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-xs font-medium text-foreground">
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  type={show ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-input bg-surface px-3 py-2 pr-10 text-sm text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-label="Toggle password visibility"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-brand py-2.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Need an account?{' '}
            <Link href="/auth/register" className="text-foreground underline underline-offset-4">
              Create the first admin
            </Link>
          </p>
        </div>

        <p className="mx-auto max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
          Self-hosted Supabase Multitenant — each project runs its own isolated stack.
        </p>
      </div>

      <div className="relative hidden border-l border-border bg-surface lg:flex lg:items-center lg:justify-center">
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div className="absolute right-6 top-6 flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground"
          >
            <BookOpen className="h-3.5 w-3.5" /> Documentation
          </Link>
        </div>
        <blockquote className="relative max-w-sm px-8">
          <p className="text-2xl font-medium leading-snug text-foreground">
            “Every team gets its own Postgres, its own auth and its own storage — without a second
            control plane.”
          </p>
          <footer className="mt-6 flex items-center gap-3">
            <span className="h-9 w-9 rounded-full bg-gradient-to-br from-brand to-brand-strong" />
            <span className="text-sm text-muted-foreground">Supabase Multitenant</span>
          </footer>
        </blockquote>
      </div>
    </div>
  )
}
