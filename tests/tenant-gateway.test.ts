import { describe, expect, it } from 'vitest'

import {
  MAX_TENANTS,
  TENANT_LISTENER_PORT_BASE,
  TENANT_PUBLISHED_PORT_BASE,
  allocateTenantSlot,
  apiHostFor,
  buildTenantRouterConfig,
  slotFromEnv,
  studioHostFor,
  tenantRouterFileName,
  tenantSlot,
} from '../src/lib/tenant-gateway'

const BASE = '213.47.80.26.sslip.io'

describe('tenant slots', () => {
  it('maps a slot to its listener and published port', () => {
    expect(tenantSlot(0)).toEqual({ slot: 0, listenerPort: 8100, publishedPort: 11130 })
    expect(tenantSlot(4)).toEqual({ slot: 4, listenerPort: 8104, publishedPort: 11134 })
  })

  it('refuses a slot outside the published range', () => {
    expect(() => tenantSlot(-1)).toThrow(/outside/)
    expect(() => tenantSlot(MAX_TENANTS)).toThrow(/outside/)
    expect(() => tenantSlot(1.5)).toThrow(/outside/)
  })

  it('starts the ranges where the live gateway is bound', () => {
    // These two constants are matched by real port bindings on the gateway container; changing
    // them silently would point every router at a port nobody listens on.
    expect(TENANT_LISTENER_PORT_BASE).toBe(8100)
    expect(TENANT_PUBLISHED_PORT_BASE).toBe(11130)
  })

  it('hands out the lowest free slot, so a deleted project returns its port', () => {
    expect(allocateTenantSlot([]).slot).toBe(0)
    expect(allocateTenantSlot([0, 1, 3]).slot).toBe(2)
    expect(allocateTenantSlot([2, 0, 1]).slot).toBe(3)
  })

  it('refuses to over-subscribe the gateway', () => {
    const all = Array.from({ length: MAX_TENANTS }, (_, i) => i)
    expect(() => allocateTenantSlot(all)).toThrow(/wider port range/)
  })
})

describe('reading a stored slot', () => {
  it('returns null for a project that has never been assigned one', () => {
    // Every project that predates the shared gateway looks like this. Treating it as slot 0 would
    // silently give two tenants the same listener.
    expect(slotFromEnv({})).toBeNull()
    expect(slotFromEnv({ GATEWAY_SLOT: '' })).toBeNull()
    expect(slotFromEnv({ GATEWAY_SLOT: 'abc' })).toBeNull()
    expect(slotFromEnv({ GATEWAY_SLOT: '-1' })).toBeNull()
    expect(slotFromEnv({ GATEWAY_SLOT: String(MAX_TENANTS) })).toBeNull()
  })

  it('parses a real slot', () => {
    expect(slotFromEnv({ GATEWAY_SLOT: '0' })).toBe(0)
    expect(slotFromEnv({ GATEWAY_SLOT: '7' })).toBe(7)
  })
})

describe('tenant hostnames', () => {
  it('drops the timestamp from the API host and keeps it on the Studio host', () => {
    const slug = 'project101-of-org202-1790168723120'
    expect(apiHostFor(slug, BASE)).toBe(`project101-of-org202.${BASE}`)
    expect(studioHostFor(slug, BASE)).toBe(`project101-of-org202-1790168723120-studio.${BASE}`)
  })

  it('leaves a slug without a timestamp alone', () => {
    expect(apiHostFor('plainname', BASE)).toBe(`plainname.${BASE}`)
  })

  it('names the router file after the slug', () => {
    expect(tenantRouterFileName('abc-123')).toBe('abc-123.yml')
  })
})

describe('the router file for a tenant', () => {
  const slug = 'abc-123'
  const yaml = buildTenantRouterConfig({ slug, baseDomain: BASE, publishedPort: 11131 })

  it('sends the API host to that tenant listener on the shared gateway', () => {
    expect(yaml).toContain('rule: Host(`abc.' + BASE + '`)')
    expect(yaml).toContain('servers: [ { url: "http://10.0.2.1:11131" } ]')
  })

  it('serves Studio through the panel, not a per-project container', () => {
    expect(yaml).toContain('rule: Host(`abc-123-studio.' + BASE + '`)')
    expect(yaml).toContain('url: "http://panel:3000"')
    expect(yaml).toContain('X-Studio-Gateway: "/gateway/studio/abc-123"')
  })

  it('terminates TLS on the https routers', () => {
    expect(yaml).toContain('tls: { certResolver: letsencrypt }')
    expect((yaml.match(/certResolver/g) || []).length).toBe(2)
  })

  it('never emits a wildcard host', () => {
    // A wildcard in a shared router is the difference between isolation and serving one tenant's
    // traffic as another's.
    expect(yaml).not.toContain('*')
  })

  it('points one port at one tenant only', () => {
    expect((yaml.match(/10\.0\.2\.1:11131/g) || []).length).toBe(1)
  })
})
