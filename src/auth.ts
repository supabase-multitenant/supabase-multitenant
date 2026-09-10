import NextAuth, { type NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import GitHub from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'

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

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  )
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
