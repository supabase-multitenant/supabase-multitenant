# Authentication

Three ways in: **email + password**, **Google**, and **GitHub**. The last two are
optional and appear on the sign-in screen only when they are configured.

## The rule that governs all of them: this panel is invite-only

Registration is closed after the first (bootstrapping) account. New people arrive
by invitation:

- **Email + password** — someone can only register if a live invitation exists for
  their exact address (`POST /api/auth/register`).
- **OAuth** — a Google or GitHub sign-in is **refused unless the address already
  has an account here or holds a live invitation** (`src/lib/oauth.ts`, enforced in
  the `signIn` callback).

This gate is not optional decoration. Without it, a bare OAuth provider would turn
an invite-only panel into a public one: Auth.js and its Prisma adapter create an
account for anyone who completes the provider's flow.

### Why the gate also checks verification

The providers are configured with email-matching account linking enabled, so that
an existing user can sign in with Google or GitHub instead of a password. That is
only safe if the provider vouches for the address — otherwise someone could
register an unverified address equal to a real user's and attach their OAuth
identity to that account.

| Provider | Reports `email_verified`? | How the gate decides |
|---|---|---|
| Google | Yes | `true` required. An explicit `false` is always refused. |
| GitHub | No | Falls back to our own record: the address must exist here *and* be verified in the panel, or carry a live invitation. |

"Not reported" is never treated as "verified".

## Enabling Google

1. **Google Cloud Console** → *APIs & Services* → *OAuth consent screen*. Fill it in
   and publish it (an app in "Testing" only accepts listed test users).
2. *Credentials* → **Create credentials** → *OAuth client ID* → *Web application*.
3. **Authorised redirect URI** — this must match exactly:

   ```
   https://<your-panel-domain>/api/auth/callback/google
   ```

4. Copy the client ID and secret into the panel's environment and restart:

   ```bash
   AUTH_GOOGLE_ID="....apps.googleusercontent.com"
   AUTH_GOOGLE_SECRET="GOCSPX-..."
   ```

That is the whole setup. The "Continue with Google" button appears as soon as both
values are present, and disappears if either is removed.

## Enabling GitHub

Same shape. GitHub → *Settings* → *Developer settings* → *OAuth Apps* →
*New OAuth App*, with the callback URL:

```
https://<your-panel-domain>/api/auth/callback/github
```

```bash
AUTH_GITHUB_ID="..."
AUTH_GITHUB_SECRET="..."
```

## Refusals are explained, not silent

A refused OAuth sign-in redirects back to the sign-in screen with a reason, taken
from a fixed set of codes (`no_email`, `email_unverified`, `invite_only`,
`provider_unverified`) that map to sentences in the login page. The server never
sends free text.

## Password reset

`/auth/forgot-password` issues a single-use, one-hour token; only its sha256 hash is
stored, and redeeming one invalidates every other outstanding token for that
account. The request endpoint answers with one neutral sentence whatever happens, so
it cannot be used to discover which addresses exist.

**While no mail transport is configured** the API returns the link instead of
emailing it, and the screen labels it "shown once". That trades away enumeration
resistance — a link coming back reveals the address exists. Setting `SMTP_HOST`
(or `RESEND_API_KEY`) flips the response to `delivery: "email"` and stops returning
links, with no other change.

## Known limitation

Sessions are JWTs, so a password reset does **not** sign other devices out. Closing
that needs a session version on the user, tracked in issue #76. The reset screen
says so plainly rather than implying otherwise.
