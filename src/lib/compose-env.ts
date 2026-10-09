/**
 * The environment a project's `docker compose` runs in.
 *
 * Compose interpolation prefers the calling process's environment over the project's `.env` file.
 * The panel therefore leaks its own settings into every tenant: its `POSTGRES_PASSWORD`,
 * `DATABASE_URL` and friends are exported in the panel container, and a tenant that also defines
 * them silently boots with the *panel's* credentials instead of its own. The failure is a
 * crash-loop (auth, rest, storage and realtime all refused by their own database), not an error
 * naming the cause — found live on 2026-10-09, where `supabase_auth_admin` could not authenticate
 * against the tenant database while the same credentials worked by hand.
 *
 * The rule here is deliberately not a list of the variables that bit us: **any key the project's
 * `.env` defines is removed from the child environment**, so the project's own file is always the
 * source of truth — including for variables nobody has thought of yet.
 */
import { promises as fs } from 'fs'
import * as path from 'path'

/** Variable names a `.env` file defines: `KEY=…` lines, ignoring blanks and comments. */
export function envKeysFromText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).trim())
    .filter(Boolean)
}

/** The keys a project's `docker/.env` defines. A missing or unreadable file yields no keys. */
export async function projectEnvKeys(dockerDir: string): Promise<string[]> {
  try {
    return envKeysFromText(await fs.readFile(path.join(dockerDir, '.env'), 'utf8'))
  } catch {
    return []
  }
}

/**
 * `panelEnv` minus every key the project defines.
 *
 * Pure, and does not mutate its input — the caller's `process.env` must survive intact, or one
 * project's compose run would strip the panel's own environment for the rest of the process.
 */
export function envWithoutKeys<T extends Record<string, string | undefined>>(
  panelEnv: T,
  keys: string[]
): T {
  const child = { ...panelEnv }
  for (const key of keys) {
    delete child[key]
  }
  return child
}

/**
 * The environment to hand `docker compose` for the project whose compose file lives in `dockerDir`.
 *
 * Use at every compose call site, so a create, deploy, pause, resume, service-group change or
 * delete can never inject the panel's configuration into a tenant.
 */
export async function composeEnv(dockerDir: string): Promise<NodeJS.ProcessEnv> {
  return envWithoutKeys(process.env, await projectEnvKeys(dockerDir))
}

