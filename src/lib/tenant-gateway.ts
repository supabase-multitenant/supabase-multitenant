/**
 * Shared-gateway plumbing for tenants.
 *
 * One envoy process (`smbt-shared-gateway`) serves every tenant: each tenant owns a *listener
 * port*, and the router in front selects the tenant by host and forwards to that port. A tenant
 * therefore has three numbers attached to it, and they must agree forever:
 *
 *   slot 0  ->  listener 8100 (in-container)  ->  published 11130  ->  Traefik target 10.0.2.1:11130
 *
 * The panel's own internal calls use the same listener by name: `http://<slug>-gw:8100`.
 *
 * This module is deliberately pure — it decides numbers and renders the router file. Applying
 * them (writing files, joining networks, reloading envoy) lives with the other docker-facing code
 * so that the arithmetic can be tested without a daemon.
 */

/** In-container listener port of slot 0. Slot N listens on `8100 + N`. */
import { parentDomainOf } from './trusted-redirect'

export const TENANT_LISTENER_PORT_BASE = 8100

/** The same listener as published on the host: `11130 + N`. Traefik targets this. */
export const TENANT_PUBLISHED_PORT_BASE = 11130

/**
 * How many tenants the gateway can carry.
 *
 * The gateway publishes one host port per tenant, and a container's port bindings are fixed when
 * it is created — so this number has to be chosen up front and the container created with the
 * whole range. Exceeding it means recreating the gateway (a short outage for every tenant on it),
 * which is why the range is generous rather than exactly the current tenant count.
 */
export const MAX_TENANTS = 20

export interface TenantSlot {
  /** Position, and the number stored on the project: `0`-based. */
  slot: number
  /** In-container listener port on the shared gateway. */
  listenerPort: number
  /** The same listener, published on the host, as Traefik must address it. */
  publishedPort: number
}

export class TenantSlotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantSlotError'
  }
}

export function tenantSlot(slot: number): TenantSlot {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_TENANTS) {
    throw new TenantSlotError(`Tenant slot ${slot} is outside 0..${MAX_TENANTS - 1}`)
  }
  return {
    slot,
    listenerPort: TENANT_LISTENER_PORT_BASE + slot,
    publishedPort: TENANT_PUBLISHED_PORT_BASE + slot,
  }
}

/**
 * The lowest slot nobody holds.
 *
 * Lowest-free rather than next-highest so that deleting and re-creating projects does not walk the
 * range upwards until it runs out: a freed slot is reusable. It is only ever handed out once,
 * because the caller persists it on the project before anything else uses it.
 */
export function allocateTenantSlot(used: number[]): TenantSlot {
  const taken = new Set(used)
  for (let slot = 0; slot < MAX_TENANTS; slot += 1) {
    if (!taken.has(slot)) return tenantSlot(slot)
  }
  throw new TenantSlotError(
    `All ${MAX_TENANTS} tenant slots are taken — the shared gateway must be recreated with a wider port range`
  )
}

/**
 * Read a slot back out of a project's stored env.
 *
 * `null` means "never assigned", which is how every project that predates the shared gateway
 * looks. Callers must treat that as "needs migrating", never as slot 0.
 */
export function slotFromEnv(env: Record<string, string | undefined>): number | null {
  const raw = env.GATEWAY_SLOT
  if (raw === undefined || raw.trim() === '') return null
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= MAX_TENANTS) return null
  return parsed
}

/** The public host a tenant's API answers on: the slug without its trailing timestamp. */
export function apiHostFor(slug: string, baseDomain: string): string {
  return `${slug.replace(/-\d+$/, '')}.${baseDomain}`
}

/** The host its Studio is served on. Studio is hoisted, so this points at the panel. */
export function studioHostFor(slug: string, baseDomain: string): string {
  return `${slug}-studio.${baseDomain}`
}

/**
 * The domain every tenant host hangs off: the panel's own parent domain.
 *
 * The panel lives at `panel.<domain>` (and each tenant at `<slug>.<domain>`, `<slug>-studio.<domain>`),
 * so the parent of the panel's host *is* the platform domain. Deriving it means one deployment
 * setting (the panel URL) decides every tenant hostname, instead of a second value that can
 * disagree with it.
 */
export function platformBaseDomain(panelUrl: string | undefined | null): string | null {
  if (!panelUrl) return null
  let hostname: string
  try {
    hostname = new URL(panelUrl.includes('://') ? panelUrl : `https://${panelUrl}`).hostname
  } catch {
    return null
  }
  const parent = parentDomainOf(hostname)
  return parent ? parent.replace(/^\./, '') : null
}

/** Router file name in the router's dynamic directory (.yml — what the panel's remover unlinks). */
export function tenantRouterFileName(slug: string): string {
  return `${slug}.yml`
}

/**
 * The router file for one tenant.
 *
 * Two routers per host (http that redirects, https that serves), because the router in front must
 * terminate TLS itself. The API router forwards to the tenant's own listener on the shared
 * gateway; the Studio router forwards to the *panel*, which proxies Studio on the tenant's behalf
 * (`/gateway/studio/<slug>`) — Studio is shared, so there is no per-tenant Studio container to
 * point at.
 *
 * The Studio middleware passes a header rather than rewriting the path: the panel normalises a
 * trailing slash, so an `addPrefix` middleware would bounce the browser in a redirect loop.
 */
export function buildTenantRouterConfig(input: {
  slug: string
  baseDomain: string
  publishedPort: number
  panelHost?: string
  panelPort?: number
}): string {
  const { slug, baseDomain, publishedPort } = input
  const panelHost = input.panelHost ?? 'panel'
  const panelPort = input.panelPort ?? 3000
  const apiHost = apiHostFor(slug, baseDomain)
  const studioHost = studioHostFor(slug, baseDomain)

  const redirect = `${slug}-redirect`
  const studioHeader = `${slug}-studio-hdr`

  return `http:
  routers:
    ${slug}-api-http:
      entryPoints: [http]
      service: ${slug}-api
      rule: Host(\`${apiHost}\`)
      middlewares: [${redirect}]
    ${slug}-api-https:
      entryPoints: [https]
      service: ${slug}-api
      rule: Host(\`${apiHost}\`)
      tls: { certResolver: letsencrypt }
    ${slug}-studio-http:
      entryPoints: [http]
      service: ${slug}-panel
      rule: Host(\`${studioHost}\`)
      middlewares: [${redirect}, ${studioHeader}]
    ${slug}-studio-https:
      entryPoints: [https]
      service: ${slug}-panel
      rule: Host(\`${studioHost}\`)
      middlewares: [${studioHeader}]
      tls: { certResolver: letsencrypt }
  middlewares:
    ${redirect}: { redirectScheme: { scheme: https, permanent: true } }
    # A header, not addPrefix: the panel normalises the trailing slash and the browser would loop.
    ${studioHeader}:
      headers:
        customRequestHeaders:
          X-Studio-Gateway: "/gateway/studio/${slug}"
  services:
    ${slug}-api:
      loadBalancer:
        # The tenant's own listener on the SHARED gateway (one gateway serves every tenant).
        servers: [ { url: "http://10.0.2.1:${publishedPort}" } ]
    ${slug}-panel:
      loadBalancer:
        servers: [ { url: "http://${panelHost}:${panelPort}" } ]
`
}
