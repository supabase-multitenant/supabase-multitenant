import Link from 'next/link'
import { AppTopbar } from '@/components/app-topbar'
import { getSessionUser } from '@/lib/auth'
import { ROLE_LABELS, type Role } from '@/lib/authz'
import { describeInvitationForVisitor } from '@/lib/invitations'
import { AcceptInvite } from './accept-invite'

export const dynamic = 'force-dynamic'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await getSessionUser()
  const invite = await describeInvitationForVisitor(token, user?.email ?? null)

  const needsSignIn = invite.found && invite.problem?.toLowerCase().includes('sign in')

  return (
    <div className="min-h-screen bg-background">
      <AppTopbar crumbs={[{ label: 'Invitation' }]} user={user ?? undefined} />
      <main className="mx-auto flex max-w-lg flex-col items-center px-6 py-16">
        <div className="w-full rounded-xl border border-border bg-card p-8">
          {!invite.found ? (
            <>
              <h1 className="text-xl font-semibold text-foreground">Invitation not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">{invite.problem}</p>
              <p className="mt-4 text-sm text-muted-foreground">
                Ask whoever invited you to send a fresh link.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-foreground">
                Join {invite.organization.name}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                You have been invited as{' '}
                <span className="font-medium text-foreground">
                  {invite.customRole?.name ?? ROLE_LABELS[invite.role as Role] ?? invite.role}
                </span>
                {invite.customRole ? ' (custom role)' : ''}.
              </p>

              <dl className="mt-5 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Organization</dt>
                  <dd className="text-foreground">{invite.organization.name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Invited address</dt>
                  <dd className="text-foreground">{invite.invitedEmail}</dd>
                </div>
                {user && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">You are signed in as</dt>
                    <dd className="text-foreground">{user.email}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Expires</dt>
                  <dd className="text-foreground">
                    {new Date(invite.expiresAt).toLocaleString()}
                  </dd>
                </div>
              </dl>

              <div className="mt-6">
                {invite.problem === null ? (
                  <AcceptInvite token={token} />
                ) : needsSignIn ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{invite.problem}</p>
                    <Link
                      href={`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                      className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    >
                      Sign in to accept
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Sign in as {invite.invitedEmail}, or register that address first.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {invite.problem}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
