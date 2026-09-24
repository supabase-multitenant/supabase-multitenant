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
  /**
   * An internal DNS name for service-to-service traffic through this same gateway, e.g.
   * `<slug>-gw`. A tenant's own services (edge functions, Studio) call the Supabase API by name
   * rather than by public host, so the tenant's listener must also accept `<internalHost>:<port>`.
   */
  internalHost?: string
  /**
   * Authority strings (`host:port`) this tenant's listener must accept in addition to its public
   * host.
   *
   * This exists because **`fetch` cannot set the `Host` header** — it is a forbidden header in the
   * fetch spec, and Node's undici silently drops it, deriving `:authority` from the URL instead. So
   * a caller that reaches the shared gateway by IP:port (the panel, which is not on the tenant's
   * network) can never present the tenant's public host. Envoy then matches no virtual host and the
   * RBAC filter denies with `matched policy none`.
   *
   * Each tenant's listener is on its own port, so accepting `10.0.2.1:<that tenant's port>` stays
   * tenant-specific: another tenant's traffic arrives on a different port and cannot match here.
   */
  internalAuthorities?: string[]
  /**
   * This tenant's own keys. Required: the listener template embeds `$ANON_KEY` and friends in its
   * JWT/RBAC filters, and in a shared gateway those placeholders must be resolved **per tenant**.
   * Leaving them unresolved would either bake one tenant's key into every virtual host or ship
   * the literal placeholder string.
   */
  secrets: TenantGatewaySecrets
}

/** Per-tenant values the listener template interpolates into its auth filters. */
export interface TenantGatewaySecrets {
  anonKey: string
  serviceRoleKey: string
  /** The tenant's own public URL — used in redirects and CORS, so it must not be a shared value. */
  publicUrl: string
  publishableKey?: string
  secretKey?: string
  anonKeyAsymmetric?: string
  serviceRoleKeyAsymmetric?: string
}

/**
 * Placeholders that belong to the shared platform, not to a tenant.
 *
 * Studio is hoisted into the shared plane, so its dashboard credential is the platform's single
 * credential. A per-tenant basic auth for a shared dashboard would be meaningless (and would mean
 * N dashboards, i.e. the thing this phase removes).
 */
export const PLATFORM_LEVEL_PLACEHOLDERS = ['DASHBOARD_BASIC_AUTH'] as const

/** Resolve this tenant's keys into its listener fragment. */
export function substituteTenantSecrets(
  fragment: string,
  secrets: TenantGatewaySecrets
): string {
  const values: Record<string, string | undefined> = {
    ANON_KEY: secrets.anonKey,
    SERVICE_ROLE_KEY: secrets.serviceRoleKey,
    SUPABASE_PUBLIC_URL: secrets.publicUrl,
    SUPABASE_PUBLISHABLE_KEY: secrets.publishableKey,
    SUPABASE_SECRET_KEY: secrets.secretKey,
    ANON_KEY_ASYMMETRIC: secrets.anonKeyAsymmetric,
    SERVICE_ROLE_KEY_ASYMMETRIC: secrets.serviceRoleKeyAsymmetric,
  }

  let output = fragment
  for (const [name, value] of Object.entries(values)) {
    // Absent optional keys resolve to empty, matching the upstream entrypoint's behaviour.
    output = output.replaceAll(`\${${name}}`, value ?? '')
  }
  return output
}

/**
 * Tenant-scoped placeholders still unresolved in a fragment.
 *
 * A survivor means one tenant's virtual host would be built from another tenant's key (or from the
 * literal string `$ANON_KEY`) — both are cross-tenant auth failures, so the caller must throw.
 * Platform-level placeholders are expected to survive into the shared entrypoint.
 */
export function findUnresolvedPlaceholders(fragment: string): string[] {
  const found = [...fragment.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1])
  const platform = new Set<string>(PLATFORM_LEVEL_PLACEHOLDERS)
  return [...new Set(found.filter((name) => !platform.has(name)))]
}

/**
 * Does one tenant's secret appear inside another tenant's segment of the listener?
 *
 * The strongest isolation property available without running envoy: if tenant B's segment contains
 * tenant A's anon key, then A's requests could be authenticated as B.
 *
 * Segments are bounded by each tenant's host marker in *document order*, not by a naive
 * `split(host)` — each fragment embeds the full template, so "everything after A's host" would
 * otherwise include all of B and report a false leak on a correct config.
 */
export function findCrossTenantSecretLeaks(
  listener: string,
  tenants: TenantGatewayInput[]
): Array<{ tenant: string; leaks: string[] }> {
  const markers = tenants
    .map((tenant) => ({ slug: tenant.slug, at: listener.indexOf(`- '${tenant.host}'`) }))
    .filter((marker) => marker.at >= 0)
    .sort((a, b) => a.at - b.at)

  const segmentOf: Record<string, string> = {}
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].at
    const end = i + 1 < markers.length ? markers[i + 1].at : listener.length
    segmentOf[markers[i].slug] = listener.slice(start, end)
  }

  const results: Array<{ tenant: string; leaks: string[] }> = []

  for (const tenant of tenants) {
    const own = segmentOf[tenant.slug]
    if (own === undefined) continue

    const leaks: string[] = []
    for (const other of tenants) {
      if (other.slug === tenant.slug) continue
      const foreign = [other.secrets?.anonKey, other.secrets?.serviceRoleKey].filter(
        (value) => typeof value === 'string' && value.length > 8 && own.includes(value)
      )
      if (foreign.length > 0) leaks.push(other.slug)
    }

    if (leaks.length > 0) results.push({ tenant: tenant.slug, leaks })
  }

  return results
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
export function restrictVirtualHostDomains(
  fragment: string,
  host: string,
  extraDomains: string[] = []
): string {
  if (!host || host === '*' || host.includes('*')) {
    throw new GatewayIsolationError(
      `Refusing to build a shared listener for wildcard host ${JSON.stringify(host)}`,
      [host]
    )
  }

  for (const extra of extraDomains) {
    if (extra === '*' || extra.includes('*')) {
      throw new GatewayIsolationError(
        `Refusing to add a wildcard extra domain ${JSON.stringify(extra)}`,
        [extra]
      )
    }
  }

  const lines = fragment.split('\n')
  const domains = [`'${host}'`, `'${host}:*'`, ...extraDomains.map((d) => `'${d}'`)]
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

/**
 * A CDS cluster definition for one tenant service.
 *
 * The `address` is the tenant's **namespaced network alias** (`<slug>-auth`), not the bare service
 * name. This is required, not cosmetic: the shared gateway is attached to every tenant's network at
 * once, and each of those networks defines `auth`, `rest`, `db`, … If the cluster addressed the
 * bare name, Docker's embedded DNS would have several candidates and no rule for choosing between
 * them — tenant A's request could be routed to tenant B's Auth. A `<slug>-` prefix is unique across
 * all attached networks, so resolution is unambiguous.
 */
export function buildTenantCluster(
  slug: string,
  serviceHost: string,
  service: string,
  port: number
): string {
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
    `                      address: ${tenantNetworkAlias(slug, service)}`,
    `                      port_value: ${port}`,
  ].join('\n')
}

/**
 * The Docker DNS name a tenant's service answers to.
 *
 * Read off the real generated compose, not assumed: the template sets an explicit
 * `container_name` for every service, and that name — not the compose service key — is what Docker
 * registers as the network alias. Four of them do **not** follow `<slug>-<service>`:
 *
 *   api-gw    -> <slug>-envoy
 *   functions -> <slug>-edge-functions
 *   supavisor -> <slug>-pooler
 *   realtime  -> realtime-dev.<slug>-realtime
 *
 * Using the service key here would produce a config that resolves to nothing.
 */
export function tenantContainerName(slug: string, service: string): string {
  switch (service) {
    case 'api-gw':
      return `${slug}-envoy`
    case 'functions':
      return `${slug}-edge-functions`
    case 'supavisor':
      return `${slug}-pooler`
    case 'realtime':
      return `realtime-dev.${slug}-realtime`
    default:
      return `${slug}-${service}`
  }
}

/** Backwards-compatible alias: the network alias IS the container name. */
export function tenantNetworkAlias(slug: string, service: string): string {
  return tenantContainerName(slug, service)
}

/** service -> the DNS name a tenant stack actually publishes. */
export function buildTenantAliases(slug: string): Record<string, string> {
  return Object.fromEntries(TENANT_UPSTREAMS.map((u) => [u.service, tenantContainerName(slug, u.service)]))
}

/**
 * Build the shared CDS: every tenant's every service, each namespaced.
 *
 * `address` is the tenant's own namespaced network alias, resolved by Docker DNS on the tenant's
 * network — which is why the shared gateway needs a network attachment per tenant (phase 1 routing
 * work), not a shared network.
 */
export function buildSharedClusters(tenants: TenantGatewayInput[]): string {
  const blocks: string[] = []
  for (const tenant of tenants) {
    for (const upstream of TENANT_UPSTREAMS) {
      blocks.push(
        buildTenantCluster(tenant.slug, upstream.host, upstream.service, upstream.port)
      )
    }
  }
  return `resources:\n${blocks.join('\n\n')}\n`
}

/**
 * Give a tenant's listener fragment its own name and port.
 *
 * The template names every listener `supabase` and binds it to 8000, which is correct for one
 * project per envoy and impossible for several in one process — envoy rejects duplicate listener
 * addresses. Each tenant therefore gets a distinct port inside the shared gateway; the router in
 * front (Traefik) selects the tenant by host and targets that port.
 */
export function retargetListener(
  fragment: string,
  options: { name: string; port: number }
): string {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new GatewayIsolationError(`Invalid listener port ${options.port}`, [String(options.port)])
  }

  const lines = fragment.split('\n')
  let sawName = false
  let sawPort = false

  for (let i = 0; i < lines.length; i++) {
    // The listener resource's own `name:` is the first one in the fragment, at the shallowest
    // indent; route_config and virtual_host names come later and deeper.
    if (!sawName && /^\s{4,8}name:\s*supabase\s*$/.test(lines[i])) {
      lines[i] = lines[i].replace(/name:\s*supabase\s*$/, `name: ${options.name}`)
      sawName = true
      continue
    }
    if (!sawPort && /^\s{8,12}port_value:\s*8000\s*$/.test(lines[i])) {
      // Only the listener's bind port — not any cluster endpoint port.
      if (lines[i].includes('socket_address') || isBelowListenerAddress(lines, i)) {
        lines[i] = lines[i].replace(/port_value:\s*8000\s*$/, `port_value: ${options.port}`)
        sawPort = true
      }
    }
  }

  if (!sawName) {
    throw new GatewayIsolationError(
      `Could not find the listener name in a fragment — refusing to retarget it`,
      [options.name]
    )
  }

  return lines.join('\n')
}

/** Is this line inside the listener's own `address:` block rather than a cluster endpoint? */
function isBelowListenerAddress(lines: string[], index: number): boolean {
  for (let i = index - 1; i >= 0 && i > index - 12; i--) {
    if (/^\s*address:\s*$/.test(lines[i])) return true
    // A `routes:`/`clusters:`/`load_assignment:` section means we are past the listener header.
    if (/^\s*(routes|load_assignment|endpoints|lb_endpoints):\s*$/.test(lines[i])) return false
  }
  return false
}

/**
 * Build the shared LDS: one listener per tenant, each on its own port.
 *
 * ## Why per-tenant listeners rather than one merged listener
 *
 * The obvious "one listener, N virtual hosts" design is blocked by the template's own structure:
 * the `jwt_authn` filter holds a single global provider set, and each provider carries a
 * **per-tenant key** in its `local_jwks`. There is no per-virtual-host override for provider
 * *keys* — only for which requirement a route asks for. Serving N tenants with N different keys
 * from one listener would mean rewriting the 1,100-line JWT/RBAC filter block of the real
 * template, which is precisely where an isolation bug would hide and never be noticed.
 *
 * Per-tenant listeners keep every tenant's filter chain byte-identical to the config that is
 * known to work today, while still collapsing N gateway *containers* into one — which is the
 * 93.8 MiB per project that ADR-0003 measured. The trade-off is explicit: we remove the duplicated
 * container and its healthcheck/ports/config, not the per-tenant listener definition.
 *
 * Domains are still restricted per tenant even though each listener is port-scoped. That is
 * deliberate defence in depth: it costs nothing, and if anyone ever merges these listeners the
 * wildcard is the difference between isolation and a cross-tenant leak.
 */
export function buildSharedListener(
  tenants: TenantGatewayInput[],
  ldsFragmentTemplate: string,
  options: { basePort?: number } = {}
): { lds: string; ports: Record<string, number> } {
  if (tenants.length === 0) {
    throw new GatewayIsolationError('Cannot build a shared listener with no tenants', [])
  }

  const basePort = options.basePort ?? 8000
  const ports: Record<string, number> = {}
  const listeners: string[] = []

  tenants.forEach((tenant, index) => {
    const port = basePort + index
    ports[tenant.slug] = port

    // Keys first: the fragment's filters reference them, and an unresolved tenant placeholder in a
    // shared config is a cross-tenant auth failure.
    let fragment = substituteTenantSecrets(ldsFragmentTemplate, tenant.secrets)

    const unresolved = findUnresolvedPlaceholders(fragment)
    if (unresolved.length > 0) {
      throw new GatewayIsolationError(
        `Tenant "${tenant.slug}" has unresolved tenant-scoped placeholders — its virtual host ` +
          `would be built from a shared or missing value`,
        unresolved
      )
    }

    fragment = namespaceClusterRefs(fragment, tenant.slug)

    // Internal (service-to-service) traffic addresses the gateway by name on a per-tenant port,
    // so the tenant's own listener must accept that host too — e.g. `drill-…-gw:8102`. It is
    // tenant-specific and port-specific, so it cannot match a sibling's listener.
    //
    // `internalAuthorities` covers the other internal caller: anything reaching the gateway by
    // IP:port (the panel), which cannot present a Host header at all because fetch forbids it.
    const extraDomains = [
      ...(tenant.internalHost ? [`${tenant.internalHost}:${port}`] : []),
      ...(tenant.internalAuthorities ?? []),
    ]
    fragment = restrictVirtualHostDomains(fragment, tenant.host, extraDomains)

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

    listeners.push(retargetListener(fragment.trimEnd(), { name: `supabase-${tenant.slug}`, port }))
  })

  // One `resources:` header for all listeners, not one per fragment.
  const body = listeners
    .map((listener) => listener.replace(/^\s*resources:\s*\n/, ''))
    .join('\n')
  const lds = `resources:\n${body}\n`

  const assigned = Object.values(ports)
  if (new Set(assigned).size !== assigned.length) {
    throw new GatewayIsolationError('Two tenants were assigned the same listener port', [
      ...assigned.map(String),
    ])
  }

  const leaks = findCrossTenantSecretLeaks(lds, tenants)
  if (leaks.length > 0) {
    throw new GatewayIsolationError(
      "A tenant's credentials appear inside another tenant's virtual host",
      leaks.map((l) => `${l.tenant} exposes ${l.leaks.join(', ')}`)
    )
  }

  return { lds, ports }
}

/** Both halves of the shared gateway config, ready to be written next to each other. */
export interface SharedGatewayConfig {
  cds: string
  lds: string
  /** tenant slug -> the port its listener accepts on, for the router in front to target. */
  ports: Record<string, number>
}

export function buildSharedGateway(
  tenants: TenantGatewayInput[],
  ldsFragmentTemplate: string,
  options: { basePort?: number } = {}
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
  const { lds, ports } = buildSharedListener(tenants, ldsFragmentTemplate, options)

  // Belt and braces on the assembled document, not just the fragments.
  const strayInLds = [...slugs].flatMap((slug) => findClusterRefsNotOwnedBy(lds, slug))
  const cdsClusters = [...cds.matchAll(/^\s*name:\s*(\S+)$/gm)].map((m) => m[1])
  const unnamespacedClusters = cdsClusters.filter(
    (name) => ![...slugs].some((s) => name.startsWith(`${s}-`))
  )

  if (unnamespacedClusters.length > 0) {
    throw new GatewayIsolationError(
      'Shared CDS contains cluster names that belong to no tenant',
      unnamespacedClusters
    )
  }

  return { cds, lds, ports }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
