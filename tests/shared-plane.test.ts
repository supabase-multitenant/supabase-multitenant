import { describe, expect, it } from 'vitest'

import {
  PER_PROJECT_SERVICES,
  SHARED_PLANE_SERVICES,
  SHARED_PLANE_NAME,
  SharedPlaneLeakError,
  buildSharedPlaneCompose,
  findSharedPlaneServices,
  listServiceNames,
  parseServiceBlocks,
  splitProjectCompose,
} from '@/lib/shared-plane'

/**
 * The shape that actually shipped for every project before ADR-0003: the complete self-hosted
 * Supabase stack, 11 services, including the gateway (`api-gw`) and the dashboard (`studio`)
 * that the product promises to run once.
 *
 * Kept faithful to the generated file, including the comment above `supavisor` and the
 * `volumes:` trailer, because the parser has to survive both.
 */
const GENERATED_STACK = `name: supabase

services:
  studio:
    container_name: supabase-studio
    image: supabase/studio:2026.09.07-sha-7996410
    environment:
      STUDIO_PG_META_URL: http://meta:8080

  api-gw:
    container_name: supabase-envoy
    image: envoyproxy/envoy:v1.39.1
    networks:
      default:
        aliases:
          - envoy
          - kong

  auth:
    container_name: supabase-auth
    image: supabase/gotrue:v2.196.0
    environment:
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:pw@db:5432/postgres

  rest:
    container_name: supabase-rest
    image: postgrest/postgrest:v14.17
    environment:
      PGRST_DB_URI: postgres://authenticator:pw@db:5432/postgres

  realtime:
    container_name: realtime-dev.supabase-realtime
    image: supabase/realtime:v2.134.10
    environment:
      DB_HOST: db
      DB_NAME: postgres

  storage:
    container_name: supabase-storage
    image: supabase/storage-api:v1.74.0
    environment:
      DATABASE_URL: postgres://supabase_storage_admin:pw@db:5432/postgres

  imgproxy:
    container_name: supabase-imgproxy
    image: darthsim/imgproxy:v3.31.4

  meta:
    container_name: supabase-meta
    image: supabase/postgres-meta:v0.99.0
    environment:
      PG_META_DB_HOST: db
      PG_META_DB_NAME: postgres

  functions:
    container_name: supabase-edge-functions
    image: supabase/edge-runtime:v1.76.2
    environment:
      SUPABASE_DB_URL: postgresql://postgres:pw@db:5432/postgres

  db:
    container_name: supabase-db
    image: supabase/postgres:17.6.1.136

  # Update the DATABASE_URL if you are using an external Postgres database
  supavisor:
    container_name: supabase-pooler
    image: supabase/supavisor:2.9.12
    environment:
      DATABASE_URL: ecto://supabase_admin:pw@db:5432/_supabase

volumes:
  db-config:
  deno-cache:
`

describe('the invariant — a project stack must not duplicate the shared plane', () => {
  it('catches the pre-ADR-0003 layout: all five shared services were being copied per project', () => {
    // This is the assertion that matters. Against the inherited template it is non-empty, which
    // is the regression it exists to prevent. It becomes empty only once the split is applied.
    expect(findSharedPlaneServices(GENERATED_STACK).sort()).toEqual(
      [...SHARED_PLANE_SERVICES].sort()
    )
  })

  it('is empty for a stack that has been split', () => {
    const { projectCompose } = splitProjectCompose(GENERATED_STACK, 'playgroundsb1-1788963289601')
    expect(findSharedPlaneServices(projectCompose)).toEqual([])
    expect(() =>
      splitProjectCompose(projectCompose, 'playgroundsb1-1788963289601')
    ).not.toThrow(SharedPlaneLeakError)
  })
})

describe('parseServiceBlocks', () => {
  it('reads every service name in file order', () => {
    expect(listServiceNames(GENERATED_STACK)).toEqual([
      'studio',
      'api-gw',
      'auth',
      'rest',
      'realtime',
      'storage',
      'imgproxy',
      'meta',
      'functions',
      'db',
      'supavisor',
    ])
  })

  it('stops at the trailer and does not treat volumes as services', () => {
    expect(listServiceNames(GENERATED_STACK)).not.toContain('db-config')
    expect(listServiceNames(GENERATED_STACK)).not.toContain('deno-cache')
    const blocks = parseServiceBlocks(GENERATED_STACK)
    expect(blocks.at(-1)?.name).toBe('supavisor')
  })

  it('keeps a service comment with the service it precedes', () => {
    const pooler = parseServiceBlocks(GENERATED_STACK).find((b) => b.name === 'supavisor')
    expect(pooler?.lines[0]).toContain('Update the DATABASE_URL')
  })

  it('rejects a document with no services section', () => {
    expect(() => parseServiceBlocks('name: nope\n')).toThrow(/no top-level `services:` key/)
  })
})

describe('splitProjectCompose', () => {
  const slug = 'project101-of-org202-1790168723120'
  const result = splitProjectCompose(GENERATED_STACK, slug)

  it('hoists exactly the services that hold no tenant database', () => {
    expect(result.hoisted.sort()).toEqual([...SHARED_PLANE_SERVICES].sort())
  })

  it('leaves exactly the services that bind one tenant database', () => {
    expect(listServiceNames(result.projectCompose).sort()).toEqual([...PER_PROJECT_SERVICES].sort())
  })

  it('keeps the per-project services byte-identical to the template', () => {
    for (const name of PER_PROJECT_SERVICES) {
      const source = parseServiceBlocks(GENERATED_STACK).find((b) => b.name === name)
      const kept = parseServiceBlocks(result.projectCompose).find((b) => b.name === name)
      expect(kept?.lines).toEqual(source?.lines)
    }
  })

  it('is idempotent', () => {
    const once = splitProjectCompose(GENERATED_STACK, slug).projectCompose
    expect(splitProjectCompose(once, slug).projectCompose).toEqual(once)
  })

  it('preserves the trailer so per-project volumes survive the split', () => {
    // db-config and deno-cache belong to db/functions, so dropping the trailer would emit a
    // project stack that cannot start.
    expect(result.projectCompose).toContain('volumes:')
    expect(result.projectCompose).toContain('db-config:')
    expect(result.projectCompose).toContain('deno-cache:')
  })

  it('refuses to emit an empty stack', () => {
    const sharedOnly = GENERATED_STACK.split('  auth:')[0]
    expect(() => splitProjectCompose(sharedOnly, slug)).toThrow(/no per-project services/)
  })
})

describe('buildSharedPlaneCompose', () => {
  const { sharedServices } = splitProjectCompose(GENERATED_STACK, 'any-slug')
  const shared = buildSharedPlaneCompose(sharedServices, { volumes: ['shared-config'] })

  it('names the shared plane distinctly from any project', () => {
    expect(shared).toContain(`name: ${SHARED_PLANE_NAME}`)
  })

  it('carries every hoisted service', () => {
    expect(listServiceNames(shared).sort()).toEqual([...SHARED_PLANE_SERVICES].sort())
  })

  it('keeps the pooler pointed at its own metadata DB, not a tenant DB', () => {
    // This is what makes a *shared* pooler possible: Supavisor stores its tenants in
    // `/_supabase`, so one pooler can multiplex every project's database.
    expect(shared).toContain('/_supabase')
  })

  it('does not contain per-project services', () => {
    for (const name of PER_PROJECT_SERVICES) {
      expect(listServiceNames(shared)).not.toContain(name)
    }
  })
})
