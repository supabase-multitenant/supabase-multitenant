'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Copy, Loader2, Mail } from 'lucide-react'
import { BrandLogo } from '@/components/brand'

/**
 * Request a password reset link.
 *
 * The screen shows one neutral sentence whatever happens, so it cannot be used
 * to discover which addresses have accounts. When no mail transport is
 * configured the API also returns the link, which is then shown here with an
 * explicit note — otherwise the feature would be unusable.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [resetUrl, setResetUrl] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    setResetUrl(null)
    setNote(null)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong.')
      setMessage(json.message)
      setResetUrl(json.resetUrl ?? null)
      setNote(json.note ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
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
          <h1 className="text-lg font-semibold text-foreground">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter the email address on your account and we will issue a reset link.
          </p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Email</span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25"
              />
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send reset link
            </button>
          </form>

          {message && (
            <div className="mt-5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
              <p className="flex items-start gap-2 text-sm text-emerald-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{message}</span>
              </p>

              {resetUrl && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-emerald-300">
                    Reset link — shown once
                  </p>
                  {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={resetUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(resetUrl)
                        setCopied(true)
                      }}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <Link
                    href={resetUrl.replace(/^https?:\/\/[^/]+/, '')}
                    className="mt-2 inline-block text-xs text-emerald-300 underline"
                  >
                    Open the reset page
                  </Link>
                </div>
              )}
            </div>
          )}

          <div className="mt-5 border-t border-border pt-4">
            <Link
              href="/auth/login"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
