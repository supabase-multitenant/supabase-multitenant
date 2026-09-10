import NextAuth, { type NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { evaluateOAuthSignIn, isOAuthProviderConfigured } from '@/lib/oauth'

/**
 * Auth.js (next-auth v5) — see docs/adr/0001-authjs.md
 *
 * Notes:
 * - Session strategy is **JWT** (signed cookie), which is the only strategy
 *   Auth.js supports together with the Credentials provider.
 * - The session cookie is named `session` (the name the legacy system used) so
 *   the existing middleware, API routes and the Studio gateway keep working
 *   unchanged while the auth engine underneath is replaced.
 * - `trustHost` is required behind Coolify's reverse proxy.
 */
const secret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  process.env.SERVICE_PASSWORD_NEXTAUTHSECRET

// Only advertise GitHub when it is actually configured.
const providers: NextAuthConfig['providers'] = [
  Credentials({
    name: 'Email and password',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      const email = String(credentials?.email ?? '').toLowerCase().trim()
      const password = String(credentials?.password ?? '')
      if (!email || !password) return null

      const user = await prisma.user.findUnique({ where: { email } })
      if (!user || !user.password) return null
      if (user.disabled) return null

      const ok = await bcrypt.compare(password, user.password)
      if (!ok) return null

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
      }
    },
  }),
]

// OAuth providers are only advertised when their credentials are actually
// present, so an unconfigured panel shows no dead buttons.
if (isOAuthProviderConfigured('google')) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Linking an OAuth identity to an existing account by matching email is
      // only enabled because the signIn callback below refuses any address the
      // provider has not verified (and, for providers that report nothing, any
      // address we have not already verified ourselves). Without that gate this
      // flag is an account-takeover vector.
      allowDangerousEmailAccountLinking: true,
    }),
  )
}

if (isOAuthProviderConfigured('github')) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  )
}

/**
 * Where to send someone the gate refused.
 *
 * Auth.js only lets the callback answer with a URL or a plain false, so the
 * refusal code travels in the query string and the login screen maps it to a
 * sentence. Absolute when we know our own origin, otherwise Auth.js falls back
 * to its generic AccessDenied page.
 */
function oauthDeniedRedirect(code: string): string | false {
  const base = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  if (!base) return false
  return `${base}/auth/login?error=oauth_denied&reason=${encodeURIComponent(code)}`
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  secret,
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 24 * 60 * 60 },
  pages: { signIn: '/auth/login' },
  providers,
  cookies: {
    sessionToken: {
      name: 'session',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        // Secure is decided per-request via the proxy header; Auth.js only sets
        // the cookie over HTTPS so a plain `http://ip:3000` dev access still works.
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  callbacks: {
    /**
     * The invite-only boundary, applied to OAuth.
     *
     * Email/password registration enforces it in its own route, but an OAuth
     * provider does not: with a bare provider configured, the adapter would
     * create an account for any stranger who completes the provider's flow. This
     * is what keeps "sign in with Google" from turning the panel public, and
     * what makes email-matching account linking safe.
     */
    async signIn({ user, account, profile }) {
      const provider = account?.provider ?? ''

      // Credentials sign-ins were already authorised inside their provider.
      if (provider === 'credentials') return true

      const raw = (profile ?? {}) as Record<string, unknown>
      const email = (typeof raw.email === 'string' ? raw.email : user?.email) ?? null

      // Google reports `email_verified`; GitHub does not report it at all, and
      // "not reported" must not be read as "verified".
      const emailVerified =
        typeof raw.email_verified === 'boolean' ? raw.email_verified : null

      const normalized = email?.trim().toLowerCase() ?? ''

      let existingUser = false
      let knownAddressVerified = false
      if (normalized) {
        const found = await prisma.user.findUnique({
          where: { email: normalized },
          select: { id: true, emailVerified: true },
        })
        existingUser = Boolean(found)
        knownAddressVerified = Boolean(found?.emailVerified)
      }

      const pendingInvitation =
        normalized.length > 0 &&
        (await prisma.invitation.count({
          where: { email: normalized, status: 'pending', expiresAt: { gt: new Date() } },
        })) > 0

      const verdict = evaluateOAuthSignIn({
        provider,
        email,
        emailVerified,
        existingUser,
        knownAddressVerified,
        pendingInvitation,
      })

      if (verdict.allow) {
        console.log(`[auth] oauth allowed: ${provider} ${normalized} (${verdict.reason})`)
        return true
      }

      console.warn(`[auth] oauth refused: ${provider} ${normalized || '(no email)'} — ${verdict.code}`)
      return oauthDeniedRedirect(verdict.code)
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id?: string }).id
        token.role = (user as { role?: string }).role ?? 'member'
      }
      // Re-check the DB so a disabled account loses access on the next refresh.
      if (token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true, disabled: true },
        })
        if (!dbUser || dbUser.disabled) return null
        token.role = dbUser.role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? token.sub ?? ''
        session.user.role = (token.role as string) ?? 'member'
      }
      return session
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
