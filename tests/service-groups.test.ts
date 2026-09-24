import { describe, expect, it } from 'vitest'

import {
  ALWAYS_ON_GROUPS,
  ENABLED_SERVICES_KEY,
  SERVICE_GROUPS,
  ServiceGroupError,
  composeServicesFor,
  groupCatalog,
  parseEnabledGroups,
  serializeEnabledGroups,
  servicesToStop,
} from '@/lib/service-groups'

describe('the group catalog matches real compose service names', () => {
  it('covers exactly the nine services a project compose can contain', () => {
    const all = Object.values(SERVICE_GROUPS).flat().sort()
    expect(all).toEqual(
      ['auth', 'db', 'imgproxy', 'meta', 'realtime', 'rest', 'storage', 'studio', 'functions'].sort()
    )
  })

  it('keeps the three services a usable Supabase cannot do without', () => {
    expect(SERVICE_GROUPS.core).toEqual(['db', 'auth', 'rest'])
  })

  it('travels storage with imgproxy, because storage cannot resize images without it', () => {
    expect(SERVICE_GROUPS.storage).toContain('imgproxy')
  })

  it('marks core as non-optional', () => {
    expect(ALWAYS_ON_GROUPS).toEqual(['core'])
    expect(groupCatalog().filter((g) => !g.optional).map((g) => g.name)).toEqual(['core'])
  })
})

describe('parseEnabledGroups', () => {
  it('defaults to core only when nothing is stored', () => {
    expect(parseEnabledGroups(undefined)).toEqual(['core'])
    expect(parseEnabledGroups('')).toEqual(['core'])
    expect(parseEnabledGroups('   ')).toEqual(['core'])
  })

  it('always includes core, however it was stored', () => {
    expect(parseEnabledGroups('realtime')).toEqual(['core', 'realtime'])
  })

  it('parses a comma-separated list and de-duplicates', () => {
    expect(parseEnabledGroups('core,storage,storage,functions')).toEqual([
      'core',
      'storage',
      'functions',
    ])
  })

  it('rejects an unknown group instead of silently dropping it', () => {
    // A typo that is ignored produces a project quietly missing a service it believes it has.
    expect(() => parseEnabledGroups('core,realtim')).toThrow(ServiceGroupError)
  })
})

describe('serializeEnabledGroups', () => {
  it('round-trips through parse', () => {
    const serialized = serializeEnabledGroups(['storage', 'functions'])
    expect(parseEnabledGroups(serialized)).toEqual(['core', 'storage', 'functions'])
  })

  it('refuses to serialize an unknown group', () => {
    expect(() => serializeEnabledGroups(['nope'])).toThrow(ServiceGroupError)
  })
})

describe('servicesToStop', () => {
  it('stops every optional service when only core is enabled', () => {
    // This is the whole point: a database-only project should not be paying for realtime, storage,
    // functions, studio or meta.
    expect(servicesToStop(['core'])).toEqual(
      ['functions', 'imgproxy', 'meta', 'realtime', 'storage', 'studio'].sort()
    )
  })

  it('never stops a core service', () => {
    for (const groups of [['core'], ['realtime'], ['storage'], ['functions'], ['dashboard']]) {
      const stop = servicesToStop(groups)
      for (const core of SERVICE_GROUPS.core) {
        expect(stop).not.toContain(core)
      }
    }
  })

  it('does not stop what the enabled groups need', () => {
    expect(servicesToStop(['core', 'storage'])).not.toContain('imgproxy')
    expect(servicesToStop(['core', 'dashboard'])).not.toContain('meta')
  })

  it('stops nothing when everything is enabled', () => {
    expect(servicesToStop(Object.keys(SERVICE_GROUPS))).toEqual([])
  })
})

describe('composeServicesFor', () => {
  it('expands groups to compose service names', () => {
    expect(composeServicesFor(['core', 'dashboard'])).toEqual(['db', 'auth', 'rest', 'studio', 'meta'])
  })

  it('throws on an unknown group', () => {
    expect(() => composeServicesFor(['bogus'])).toThrow(ServiceGroupError)
  })
})

describe('the env var name is stable', () => {
  it('is ENABLED_SERVICES', () => {
    // Stored as a project env var rather than a column, so no schema migration is needed.
    expect(ENABLED_SERVICES_KEY).toBe('ENABLED_SERVICES')
  })
})
