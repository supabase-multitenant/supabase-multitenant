'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Check, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { BrandLogo } from '@/components/brand'

/** Kept in step with MIN_PASSWORD_LENGTH in src/lib/password-reset.ts. */
const MIN_PASSWORD_LENGTH = 8

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === 'string' ? params.token : ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH
  const mismatch = confirm.length > 0 && confirm !== password
  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && password === confirm && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not reset the password.')
      setDone(json.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <BrandLogo />
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          {done ? (
            <>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Check className="h-5 w-5 text-emerald-400" /> Password changed
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">{done}</p>
              <Link
                href="/auth/login"
                className="mt-5 inline-flex items-center gap-2 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground hover:opacity-90"
              >
                Sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-foreground">Choose a new password</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                At least {MIN_PASSWORD_LENGTH} characters. This link can only be used once.
              </p>

              <form onSubmit={submit} className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    New password
                  </span>
                  <div className="relative">
                    <input
                      type={show ? 'text' : 'password'}
                      required
                      autoFocus
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-md border border-input bg-surface px-3 py-2 pr-10 text-sm text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label={show ? 'Hide password' : 'Show password'}
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {tooShort && (
                    <span className="mt-1 block text-xs text-amber-400">
                      {MIN_PASSWORD_LENGTH - password.length} more character(s) needed.
                    </span>
                  )}
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Confirm password
                  </span>
                  <input
                    type={show ? 'text' : 'password'}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
                  />
                  {mismatch && (
                    <span className="mt-1 block text-xs text-destructive">
                      The passwords do not match.
                    </span>
                  )}
                </label>

                {error && (
                  <p className="flex items-start gap-2 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Set new password
                </button>
              </form>

              <div className="mt-5 border-t border-border pt-4">
                <Link
                  href="/auth/login"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
