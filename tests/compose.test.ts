import { describe, expect, it } from 'vitest'

import {
  UnnamespacedContainerError,
  findUnnamespacedContainerNames,
  isNamespacedContainerName,
  listContainerNames,
  namespaceContainerNames,
} from '@/lib/compose'

/**
 * Trimmed but realistic copy of a generated project stack — the shape that
 * actually shipped for playgroundSB1, including the Envoy API gateway whose
 * `container_name: supabase-envoy` was left global (issue #104).
 */
const COMPOSE = `name: supabase

services:
  studio:
    container_name: supabase-studio
    image: supabase/studio:2026.09.07-sha-7996410

  api-gw:
    container_name: supabase-envoy
    image: envoyproxy/envoy:v1.39.1
    networks:
      default:
        # aliases so configs referencing either hostname keep working
        aliases:
          - envoy
          - kong

  auth:
    container_name: supabase-auth
    image: supabase/gotrue:v2.196.0

  rest:
    container_name: supabase-rest
    image: postgrest/postgrest:v14.17

  realtime:
    container_name: realtime-dev.supabase-realtime
    image: supabase/realtime:v2.134.10

  storage:
    container_name: supabase-storage
    image: supabase/storage-api:v1.74.0

  imgproxy:
    container_name: supabase-imgproxy
    image: darthsim/imgproxy:v3.31.4

  meta:
    container_name: supabase-meta
    image: supabase/postgres-meta:v0.99.0

  functions:
    container_name: supabase-edge-functions
    image: supabase/edge-runtime:v1.76.2

  db:
    container_name: supabase-db
    image: supabase/postgres:17.6.1.136

  supavisor:
    container_name: supabase-pooler
    image: supabase/supavisor:2.9.12
`

const SLUG = 'playgroundsb1-1788963289601'

describe('namespaceContainerNames — issue #104 regression', () => {
  it('namespaces the API gateway, which used to keep a global name', () => {
    const out = namespaceContainerNames(COMPOSE, SLUG)
    expect(out).toContain(`container_name: ${SLUG}-envoy`)
    expect(out).not.toContain('container_name: supabase-envoy')
  })

  it('leaves no container sharing a global name', () => {
    const out = namespaceContainerNames(COMPOSE, SLUG)
    expect(findUnnamespacedContainerNames(out, SLUG)).toEqual([])
  })

  it('prefixes every service in the stack', () => {
    const out = namespaceContainerNames(COMPOSE, SLUG)
    expect(listContainerNames(out).sort()).toEqual(
      [
        'auth',
        'db',
        'edge-functions',
        'envoy',
        'imgproxy',
        'meta',
        'pooler',
        'rest',
        'storage',
        'studio',
      ]
        .map((s) => `${SLUG}-${s}`)
        .concat([`realtime-dev.${SLUG}-realtime`])
        .sort()
    )
  })

  it('keeps the realtime tenant prefix instead of mangling it', () => {
    const out = namespaceContainerNames(COMPOSE, SLUG)
    expect(out).toContain(`container_name: realtime-dev.${SLUG}-realtime`)
    // the generic supabase- rule must not have touched it
    expect(out).not.toContain(`${SLUG}-dev.supabase-realtime`)
  })

  it('does not rename compose service keys or network aliases', () => {
    const out = namespaceContainerNames(COMPOSE, SLUG)
    expect(out).toContain('  api-gw:')
    expect(out).toContain('  realtime:')
    expect(out).toContain('          - envoy\n          - kong')
  })

  it('is idempotent', () => {
    const once = namespaceContainerNames(COMPOSE, SLUG)
    expect(namespaceContainerNames(once, SLUG)).toEqual(once)
  })

  it('namespaces a brand-new service automatically (no mapping list to forget)', () => {
    const withNew = COMPOSE.replace(
      '  db:\n',
      '  analytics:\n    container_name: supabase-analytics\n    image: supabase/analytics:1\n\n  db:\n'
    )
    const out = namespaceContainerNames(withNew, SLUG)
    expect(out).toContain(`container_name: ${SLUG}-analytics`)
  })

  it('gives two projects different container names for the same service', () => {
    const a = namespaceContainerNames(COMPOSE, 'proj-a-1')
    const b = namespaceContainerNames(COMPOSE, 'proj-b-2')
    const namesA = new Set(listContainerNames(a))
    const namesB = new Set(listContainerNames(b))
    expect([...namesA].filter((n) => namesB.has(n))).toEqual([])
  })
})

describe('namespaceContainerNames — guard', () => {
  it('throws instead of emitting a stack with a global name', () => {
    const bad = COMPOSE.replace(
      '    container_name: supabase-db',
      '    container_name: my-global-postgres'
    )
    expect(() => namespaceContainerNames(bad, SLUG)).toThrow(UnnamespacedContainerError)
  })

  it('names the offending containers in the error', () => {
    const bad = COMPOSE.replace(
      '    container_name: supabase-db',
      '    container_name: shared-postgres'
    )
    try {
      namespaceContainerNames(bad, SLUG)
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(UnnamespacedContainerError)
      expect((error as UnnamespacedContainerError).offenders).toEqual(['shared-postgres'])
    }
  })

  it('rejects an empty or unsafe slug', () => {
    expect(() => namespaceContainerNames(COMPOSE, '')).toThrow(/Invalid project slug/)
    expect(() => namespaceContainerNames(COMPOSE, 'Bad Slug')).toThrow(/Invalid project slug/)
  })
})

describe('helpers', () => {
  it('listContainerNames reads values in file order', () => {
    expect(listContainerNames(COMPOSE)[0]).toBe('supabase-studio')
  })

  it('listContainerNames tolerates inline comments and odd spacing', () => {
    expect(listContainerNames('    container_name:   supabase-db   ')).toEqual(['supabase-db'])
  })

  it('isNamespacedContainerName accepts both conventions', () => {
    expect(isNamespacedContainerName(`${SLUG}-envoy`, SLUG)).toBe(true)
    expect(isNamespacedContainerName(`realtime-dev.${SLUG}-realtime`, SLUG)).toBe(true)
    expect(isNamespacedContainerName('supabase-envoy', SLUG)).toBe(false)
    expect(isNamespacedContainerName(`${SLUG}-envoy`, 'other-slug')).toBe(false)
  })

  it('does not confuse a similar slug prefix with a match', () => {
    // `proj-a-1-extra` must not count as scoped to `proj-a-12`
    expect(isNamespacedContainerName('proj-a-12-db', 'proj-a-1')).toBe(false)
  })
})
