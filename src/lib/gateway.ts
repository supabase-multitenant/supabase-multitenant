/**
 * The shared gateway (ADR-0003, phase 1).
 *
 * Every project stack ships its own `api-gw` (envoy) — 93.8 MiB, plus its config, ports and
 * healthcheck, duplicated per project. Phase 1 replaces all of them with **one** gateway that
 * routes every tenant.
 *
 * ## The landmine this module exists to defuse
 *
 * The per-project listener declares:
 *
 * ```yaml
 * virtual_hosts:
 *   - name: supabase_host
 *     domains:
 *       - '*'
 * ```
 *
 * That is safe **only** while each tenant has its own envoy and its own published port, because
 * Traefik has already selected the tenant by host before envoy ever sees the request. Collapse
 * those gateways into one and `'*'` means *every* tenant's listener answers for *every* host —
 * tenant A's request gets served with tenant B's keys by whichever virtual host envoy matches
 * first. That is the cross-tenant exposure ADR-0003 explicitly accepts as a risk and mitigates by
 * rule, so the transformations below are guards, not conveniences:
 *
 * 1. **Domains are restricted per tenant.** No bare `'*'` may survive into the shared listener.
 * 2. **Cluster references are namespaced per tenant.** The template says `cluster: auth`; the
 *    shared CDS holds `<slug>-auth`, so an un-namespaced reference is either a hard error or, far
 *    worse, resolves to a sibling tenant's service.
 *
 * `buildSharedGateway()` throws when either invariant would be violated, and
 * `findWildcardDomains()` / `findClusterRefsNotOwnedBy()` expose them for testing.
 */

/** Upstream service -> in-container port, read from the real generated `cds.yaml`. */
export const TENANT_UPSTREAMS = [
  { service: 'auth', host: 'auth', port: 9999 },
  { service: 'rest', host: 'rest', port: 3000 },
  { service: 'storage', host: 'storage', port: 5000 },
  { service: 'realtime', host: 'realtime-dev.supabase-realtime', port: 4000 },
  { service: 'functions', host: 'functions', port: 9000 },
  { service: 'meta', host: 'meta', port: 8080 },
  { service: 'studio', host: 'studio', port: 3000 },
] as const

/** Services a project stack no longer runs itself (they are shared, see ADR-0003). */
export const CLUSTER_NAMES = TENANT_UPSTREAMS.map((u) => u.service)

/** Raised when a shared-gateway config would not be tenant-safe. */
export class GatewayIsolationError extends Error {
  readonly offenders: string[]

  constructor(message: string, offenders: string[]) {
    super(message)
    this.offenders = offenders
    this.name = 'GatewayIsolationError'
  }
}

export interface TenantGatewayInput {
  /** The project slug; also the cluster namespace and the compose container prefix. */
  slug: string
  /** The public host this tenant answers on. Must be a single concrete host, never `*`. */
  host: string
}

/** The cluster name a tenant's service is reachable as inside the shared gateway. */
export function tenantClusterName(slug: string, service: string): string {
  return `${slug}-${service}`
}

/**
 * Rewrite every `cluster: <service>` reference to this tenant's namespace.
 *
 * A route that matches tenant A but names an un-namespaced cluster would resolve inside the shared
 * CDS to whichever tenant defined it — a cross-tenant route. The generated config is therefore
 * checked rather than assumed.
 */
export function namespaceClusterRefs(fragment: string, slug: string): string {
  let output = fragment
  for (const service of CLUSTER_NAMES) {
    // Only the bare cluster reference; `cluster_name:` in the CDS is handled separately.
    output = output.replace(
      new RegExp(`(\\bcluster:\\s*)${escapeRegExp(service)}(\\s*)$`, 'gm'),
      `$1${tenantClusterName(slug, service)}$2`
    )
  }
  return output
}

/**
 * Replace a permissive domain list with this tenant's host.
 *
 * Handles the template's `- '*'` form and any explicitly listed bare wildcard, because a wildcard
 * left in place is the difference between isolation and a cross-tenant leak.
 *
 * Line-wise rather than one greedy regex: an envoy virtual host is full of lists (`cors`,
 * `routes`, `request_headers_to_add`), and a pattern that merely matches "an indented `-` line"
 * would swallow the next one at a different indent and corrupt the config.
 */
export function restrictVirtualHostDomains(fragment: string, host: string): string {
  if (!host || host === '*' || host.includes('*')) {
    throw new GatewayIsolationError(
      `Refusing to build a shared listener for wildcard host ${JSON.stringify(host)}`,
      [host]
    )
  }

  const lines = fragment.split('\n')
  const domains = [`'${host}'`, `'${host}:*'`]
  const output: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Flow style: `domains: ['*']` on one line. Rare, but a wildcard that silently survives
    // here is the exact failure this module exists to prevent, so it is handled, not assumed away.
    const inline = line.match(/^(\s*domains:\s*)\[([^\]]*)\]/)
    if (inline) {
      output.push(`${inline[1]}[${domains.join(', ')}]`)
      continue
    }

    output.push(line)

    if (!/^\s*domains:\s*$/.test(line)) continue

    const headerIndent = (line.match(/^\s*/) ?? [''])[0]
    // The list items are the following lines indented deeper than `domains:`.
    let j = i + 1
    const itemIndent = (lines[j]?.match(/^(\s*)-/) ?? [])[1]
    if (itemIndent === undefined || itemIndent.length <= headerIndent.length) continue

    const rendered: string[] = []
    while (j < lines.length && lines[j].startsWith(`${itemIndent}-`)) {
      rendered.push(`${itemIndent}- `)
      j += 1
    }
    if (rendered.length === 0) continue

    rendered[0] = `${itemIndent}- ${domains[0]}`
    for (let k = 1; k < domains.length; k++) rendered.push(`${itemIndent}- ${domains[k]}`)

    output.push(...rendered)
    i = j - 1
  }

  return output.join('\n')
}

/**
 * Every bare `*` domain left in a listener fragment, block or flow style.
 *
 * Must be empty for a shared listener: one surviving wildcard means every tenant's listener
 * answers for every host.
 */
export function findWildcardDomains(fragment: string): string[] {
  const offenders: string[] = []

  const isWildcard = (raw: string) => {
    const value = raw.replace(/^[ \t]*-[ \t]*/, '').trim().replace(/^['"]|['"]$/g, '')
    return value === '*'
  }

  for (const block of fragment.matchAll(/domains:\s*\n((?:[ \t]*-[ \t]*.*\n)+)/g)) {
    for (const line of block[1].split('\n')) {
      if (line.trim() !== '' && isWildcard(line)) offenders.push("'*'")
    }
  }

  for (const inline of fragment.matchAll(/domains:\s*\[([^\]]*)\]/g)) {
    for (const item of inline[1].split(',')) {
      if (item.trim() !== '' && isWildcard(item)) offenders.push("'*'")
    }
  }

  return offenders
}

/** Cluster references in a fragment that are not namespaced to the given slug. */
export function findClusterRefsNotOwnedBy(fragment: string, slug: string): string[] {
  const refs = [...fragment.matchAll(/\bcluster:\s*(\S+)/g)].map((m) => m[1].replace(/['"]/g, ''))
  return refs.filter((ref) => !ref.startsWith(`${slug}-`))
}

/** A CDS cluster definition for one tenant service. */
export function buildTenantCluster(slug: string, host: string, service: string, port: number): string {
  return [
    "    - '@type': type.googleapis.com/envoy.config.cluster.v3.Cluster",
    `      name: ${tenantClusterName(slug, service)}`,
    '      connect_timeout: 5s',
    '      type: STRICT_DNS',
    '      dns_refresh_rate: 5s',
    '      lb_policy: ROUND_ROBIN',
    '      load_assignment:',
    `        cluster_name: ${tenantClusterName(slug, service)}`,
    '        endpoints:',
    '          - lb_endpoints:',
    '              - endpoint:',
    '                  address:',
    '                    socket_address:',
    `                      address: ${host}`,
    `                      port_value: ${port}`,
  ].join('\n')
}

/**
 * Build the shared CDS: every tenant's every service, each namespaced.
 *
 * `address` is the tenant's own compose service name, resolved by Docker DNS on the tenant's
 * network — which is why the shared gateway needs a network attachment per tenant (phase 1
 * routing work), not a shared network.
 */
export function buildSharedClusters(tenants: TenantGatewayInput[]): string {
  const blocks: string[] = []
  for (const tenant of tenants) {
    for (const upstream of TENANT_UPSTREAMS) {
      blocks.push(buildTenantCluster(tenant.slug, upstream.host, upstream.service, upstream.port))
    }
  }
  return `resources:\n${blocks.join('\n\n')}\n`
}

/**
 * Build the shared LDS: one listener, one virtual host per tenant, from the project template.
 *
 * The per-tenant fragment is derived from the *same* `lds.template.yaml` each project used, so
 * the shared gateway keeps the identical route set, filters and keys — only the domains and
 * cluster names change. Anything else would be a rewrite of a 1,200-line config with per-route
 * JWT/RBAC rules, which is exactly where an isolation bug would hide.
 */
export function buildSharedListener(
  tenants: TenantGatewayInput[],
  ldsFragmentTemplate: string
): string {
  if (tenants.length === 0) {
    throw new GatewayIsolationError('Cannot build a shared listener with no tenants', [])
  }

  const virtualHosts: string[] = []
  for (const tenant of tenants) {
    let fragment = namespaceClusterRefs(ldsFragmentTemplate, tenant.slug)
    fragment = restrictVirtualHostDomains(fragment, tenant.host)

    const wildcards = findWildcardDomains(fragment)
    if (wildcards.length > 0) {
      throw new GatewayIsolationError(
        `Tenant "${tenant.slug}" would still match any host in the shared listener`,
        wildcards
      )
    }

    const strayRefs = findClusterRefsNotOwnedBy(fragment, tenant.slug)
    if (strayRefs.length > 0) {
      throw new GatewayIsolationError(
        `Tenant "${tenant.slug}" references clusters it does not own (would route into another ` +
          `tenant's services)`,
        [...new Set(strayRefs)]
      )
    }

    virtualHosts.push(fragment.trimEnd())
  }

  return `resources:\n  - '@type': type.googleapis.com/envoy.config.listener.v3.Listener\n${virtualHosts.join('\n')}\n`
}

/** Both halves of the shared gateway config, ready to be written next to each other. */
export interface SharedGatewayConfig {
  cds: string
  lds: string
}

export function buildSharedGateway(
  tenants: TenantGatewayInput[],
  ldsFragmentTemplate: string
): SharedGatewayConfig {
  const slugs = new Set<string>()
  for (const tenant of tenants) {
    if (slugs.has(tenant.slug)) {
      throw new GatewayIsolationError(`Duplicate tenant slug ${JSON.stringify(tenant.slug)}`, [
        tenant.slug,
      ])
    }
    slugs.add(tenant.slug)
  }

  const cds = buildSharedClusters(tenants)
  const lds = buildSharedListener(tenants, ldsFragmentTemplate)

  // Belt and braces on the assembled document, not just the fragments.
  const strayInLds = [...slugs].flatMap((slug) => findClusterRefsNotOwnedBy(lds, slug))
  const cdsClusters = [...cds.matchAll(/^\s*name:\s*(\S+)$/gm)].map((m) => m[1])
  const unnamespacedClusters = cdsClusters.filter((name) => ![...slugs].some((s) => name.startsWith(`${s}-`)))

  if (unnamespacedClusters.length > 0) {
    throw new GatewayIsolationError(
      'Shared CDS contains cluster names that belong to no tenant',
      unnamespacedClusters
    )
  }

  return { cds, lds }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
