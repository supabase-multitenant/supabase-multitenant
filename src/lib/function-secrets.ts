/**
 * Edge-function secrets: validation and serialization.
 *
 * Pure and Prisma-free so it stays unit-testable. The write path
 * (`updateFunctionSecrets` in project.ts) turns a validated record into the
 * per-project `docker/.env.functions` file that the edge-runtime container reads.
 */

/** A valid env identifier: a letter/underscore, then letters/digits/underscores. */
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Keys the compose `functions` service sets itself via `environment:`. Those win
 * over `env_file`, so accepting them here would silently do nothing — reject them
 * so the failure is loud instead of a confusing no-op. `SUPABASE_` covers the
 * URL/keys the runtime injects.
 */
const RESERVED_EXACT = new Set(['JWT_SECRET', 'VERIFY_JWT', 'FUNCTIONS_VERIFY_JWT'])
const isReservedKey = (key: string) => RESERVED_EXACT.has(key) || key.startsWith('SUPABASE_')

export class InvalidFunctionSecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidFunctionSecretError'
  }
}

/**
 * Validate a key/value secret record. Throws {@link InvalidFunctionSecretError}
 * on the first problem — this is a trust boundary: the values are written into a
 * file that docker parses, so a stray newline would inject an extra variable.
 */
export function validateFunctionSecrets(secrets: Record<string, string>): void {
  for (const [key, value] of Object.entries(secrets)) {
    if (!KEY_PATTERN.test(key)) {
      throw new InvalidFunctionSecretError(
        `Invalid secret name "${key}": use letters, digits and underscores, not starting with a digit.`
      )
    }
    if (isReservedKey(key)) {
      throw new InvalidFunctionSecretError(
        `"${key}" is reserved by the edge runtime and cannot be overridden.`
      )
    }
    if (typeof value !== 'string') {
      throw new InvalidFunctionSecretError(`Value for "${key}" must be a string.`)
    }
    if (/[\r\n]/.test(value)) {
      throw new InvalidFunctionSecretError(`Value for "${key}" must not contain line breaks.`)
    }
  }
}

/** Serialize a validated record to `KEY=value` lines for `.env.functions`. */
export function serializeEnvFile(secrets: Record<string, string>): string {
  const lines = Object.entries(secrets).map(([key, value]) => `${key}=${value}`)
  return lines.length ? `${lines.join('\n')}\n` : ''
}
