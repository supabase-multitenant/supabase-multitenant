'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not accept the invitation.')
      router.push(`/org/${json.organizationId}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept the invitation.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => void accept()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Accept invitation
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
