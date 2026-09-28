import { describe, expect, it } from 'vitest'

import { ensureStudioAiEnv } from '@/lib/compose'

/**
 * Shaped like a project's real compose: the studio service reads OPENAI_API_KEY but no base URL,
 * which is why a project could only ever talk to OpenAI.
 */
const COMPOSE = `name: project101

services:
  studio:
    container_name: project101-studio
    image: supabase/studio:2026.09.07-sha-7996410
    restart: unless-stopped
    environment:
      HOSTNAME: "0.0.0.0"

      STUDIO_PG_META_URL: http://meta:8080
      POSTGRES_HOST: \${POSTGRES_HOST}
      OPENAI_API_KEY: \${OPENAI_API_KEY}

      SUPABASE_URL: http://project101-gw:8100

  meta:
    container_name: project101-meta
    image: supabase/postgres-meta:v0.83.2
    environment:
      PG_META_PORT: 8080

  db:
    container_name: project101-db
    image: supabase/postgres:15.8.1.060
`

describe('ensureStudioAiEnv', () => {
  it('gives the studio service a base URL, so a non-OpenAI provider is reachable', () => {
    const result = ensureStudioAiEnv(COMPOSE)

    expect(result).toContain('OPENAI_BASE_URL: ${OPENAI_BASE_URL:-https://api.openai.com/v1}')
    expect(result).toContain('OPENAI_API_KEY: ${OPENAI_API_KEY}')
  })

  it('defaults the base URL rather than allowing an empty value', () => {
    // An empty OPENAI_BASE_URL is still a URL to the SDK: it would accept it and fail every call.
    // The `:-` default is what prevents a configured-looking assistant from being broken.
    const result = ensureStudioAiEnv(COMPOSE)

    expect(result).toMatch(/OPENAI_BASE_URL: \$\{OPENAI_BASE_URL:-https?:\/\/\S+\}/)
    expect(result).not.toMatch(/OPENAI_BASE_URL: \$\{OPENAI_BASE_URL\}/)
  })

  it('is idempotent — saving the settings twice must not double the variables', () => {
    const once = ensureStudioAiEnv(COMPOSE)
    const twice = ensureStudioAiEnv(once)

    expect(twice).toBe(once)
    // Anchored to a key at the start of a line: the default value mentions the variable too.
    expect(twice.match(/^[ \t]*OPENAI_BASE_URL:/gm)).toHaveLength(1)
    expect(twice.match(/^[ \t]*OPENAI_API_KEY:/gm)).toHaveLength(1)
  })

  it('puts the variables in the studio service, not some other one', () => {
    const result = ensureStudioAiEnv(COMPOSE)
    const lines = result.split('\n')
    const studioAt = lines.findIndex((l) => l === '  studio:')
    const metaAt = lines.findIndex((l) => l === '  meta:')
    const baseUrlAt = lines.findIndex((l) => l.includes('OPENAI_BASE_URL:'))

    expect(studioAt).toBeGreaterThan(-1)
    expect(baseUrlAt).toBeGreaterThan(studioAt)
    expect(baseUrlAt).toBeLessThan(metaAt)
  })

  it('leaves the rest of the compose byte-for-byte alone', () => {
    const result = ensureStudioAiEnv(COMPOSE)
    const removed = COMPOSE.split('\n').filter((line) => !line.includes('OPENAI_BASE_URL'))

    // Every original line survives, in order.
    let cursor = -1
    for (const line of removed) {
      const at = result.indexOf(line, cursor + 1)
      expect(at, `line not found in place: ${line}`).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('leaves a project without Studio untouched instead of throwing', () => {
    const withoutStudio = `name: x\n\nservices:\n  db:\n    image: supabase/postgres:15.8.1.060\n`
    expect(ensureStudioAiEnv(withoutStudio)).toBe(withoutStudio)
  })

  it('adds an environment block when the studio service has none', () => {
    const bare = `services:\n  studio:\n    image: supabase/studio:2026.09.07-sha-7996410\n  db:\n    image: postgres:16-alpine\n`
    const result = ensureStudioAiEnv(bare)

    expect(result).toContain('    environment:')
    expect(result).toContain('      OPENAI_BASE_URL: ${OPENAI_BASE_URL:-https://api.openai.com/v1}')
    // Still inside studio, before db.
    expect(result.indexOf('OPENAI_BASE_URL')).toBeLessThan(result.indexOf('  db:'))
  })
})
