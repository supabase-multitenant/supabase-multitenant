import { describe, expect, it } from 'vitest'

import {
  GatewayIsolationError,
  PLATFORM_LEVEL_PLACEHOLDERS,
  TENANT_UPSTREAMS,
  buildSharedClusters,
  buildSharedGateway,
  buildTenantAliases,
  findClusterRefsNotOwnedBy,
  findCrossTenantSecretLeaks,
  findUnresolvedPlaceholders,
  findWildcardDomains,
  namespaceClusterRefs,
  restrictVirtualHostDomains,
  retargetListener,
  substituteTenantSecrets,
  tenantClusterName,
  tenantContainerName,
} from '@/lib/gateway'

/**
 * Trimmed but structurally faithful copy of the real `lds.template.yaml`: one listener, one
 * virtual host, `domains: ['*']`, JWT filters interpolating the tenant's keys, routes to the bare
 * cluster names, and — importantly for the domain rewrite — further lists (`cors`,
 * `request_headers_to_add`) at other indents that must not be touched.
 */
const LDS_FRAGMENT = `resources:
  - '@type': type.googleapis.com/envoy.config.listener.v3.Listener
    name: supabase
    per_connection_buffer_limit_bytes: 32768
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 8000
    filter_chains:
    - filters:
        - name: envoy.filters.network.http_connection_manager
          typed_config:
            '@type': >-
              type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
            route_config:
              name: supabase_route
              virtual_hosts:
                - name: supabase_host
                  domains:
                    - '*'
                  cors:
                    allow_origin_string_match:
                      - safe_regex:
                          regex: ".*"
                    allow_methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD"
                  typed_per_filter_config:
                    envoy.filters.http.jwt_authn:
                      '@type': type.googleapis.com/envoy.extensions.filters.http.jwt_authn.v3.PerRouteConfig
                      requirement_name: anon
                  request_headers_to_add:
                    - header:
                        key: X-Forwarded-Host
                        value: "%REQ(:AUTHORITY)%"
                      append_action: ADD_IF_ABSENT
                  routes:
                    - match:
                        prefix: /auth/v1/
                      route:
                        cluster: auth
                        timeout: 30s
                    - match:
                        prefix: /rest/v1/
                      route:
                        cluster: rest
                    - match:
                        prefix: /storage/v1/
                      route:
                        cluster: storage
                    - match:
                        prefix: /realtime/v1/
                      route:
                        cluster: realtime
                    - match:
                        prefix: /functions/v1/
                      route:
                        cluster: functions
    - name: supabase_jwt
      typed_config:
        '@type': type.googleapis.com/envoy.extensions.filters.http.jwt_authn.v3.JwtAuthentication
        providers:
          anon:
            forward: true
            local_jwks:
              inline_string: '{"keys":[{"kty":"oct","k":"\${ANON_KEY}"}]}'
            payload_in_metadata: anon_payload
          service_role:
            forward: true
            local_jwks:
              inline_string: '{"keys":[{"kty":"oct","k":"\${SERVICE_ROLE_KEY}"}]}'
            payload_in_metadata: supabase_payload
        rules:
          - match:
              prefix: /
            requires:
              provider_name: anon
        bypass_cors_preflight: true
    - name: supabase_basic_auth
      typed_config:
        '@type': type.googleapis.com/envoy.extensions.filters.http.basic_auth.v3.BasicAuth
        users:
          inline_string: "\${DASHBOARD_BASIC_AUTH}"
    - name: supabase_cors
      typed_config:
        '@type': type.googleapis.com/envoy.extensions.filters.http.cors.v3.Cors
    - name: envoy.filters.http.rbac
      typed_config:
        '@type': type.googleapis.com/envoy.extensions.filters.http.rbac.v3.RBAC
        rules:
          action: ALLOW
        public_url: "\${SUPABASE_PUBLIC_URL}"
`

const TENANTS = [
  {
    slug: 'aclient-1001',
    host: 'aclient.213.47.80.26.sslip.io',
    secrets: {
      anonKey: 'AAAA-anon-key-aaaa',
      serviceRoleKey: 'AAAA-service-role-key-aaaa',
      publicUrl: 'https://aclient.213.47.80.26.sslip.io',
    },
  },
  {
    slug: 'bclient-1002',
    host: 'bclient.213.47.80.26.sslip.io',
    secrets: {
      anonKey: 'BBBB-anon-key-bbbb',
      serviceRoleKey: 'BBBB-service-role-key-bbbb',
      publicUrl: 'https://bclient.213.47.80.26.sslip.io',
    },
  },
]

describe('the landmine: a wildcard domain must never survive into a shared listener', () => {
  it('detects the permissive domain the per-project template ships', () => {
    expect(findWildcardDomains(LDS_FRAGMENT)).toEqual(["'*'"])
  })

  it('replaces it with the concrete tenant host', () => {
    const restricted = restrictVirtualHostDomains(LDS_FRAGMENT, TENANTS[0].host)
    expect(findWildcardDomains(restricted)).toEqual([])
    expect(restricted).toContain(`- '${TENANTS[0].host}'`)
    expect(restricted).toContain(`- '${TENANTS[0].host}:*'`)
  })

  it('does not corrupt the sibling lists while rewriting domains', () => {
    const restricted = restrictVirtualHostDomains(LDS_FRAGMENT, TENANTS[0].host)
    expect(restricted).toContain('allow_methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD"')
    expect(restricted).toContain('key: X-Forwarded-Host')
    expect(restricted).toContain('regex: ".*"')
  })

  it('refuses to build for a wildcard host', () => {
    expect(() => restrictVirtualHostDomains(LDS_FRAGMENT, '*')).toThrow(GatewayIsolationError)
    expect(() => restrictVirtualHostDomains(LDS_FRAGMENT, '*.example.com')).toThrow(
      GatewayIsolationError
    )
  })

  it('handles flow-style domains rather than assuming the block form', () => {
    const inline = LDS_FRAGMENT.replace(
      "                  domains:\n                    - '*'",
      "                  domains: ['*']"
    )
    const restricted = restrictVirtualHostDomains(inline, TENANTS[0].host)
    expect(findWildcardDomains(restricted)).toEqual([])
  })

  it('throws rather than emit a listener that still matches any host', () => {
    // Ambiguous YAML: the domain items sit at the same indent as the key, so no safe rewrite
    // exists. The guard must refuse instead of shipping a listener that answers for every host.
    const ambiguous = LDS_FRAGMENT.replace(
      "                  domains:\n                    - '*'",
      "                  domains:\n                  - '*'"
    )
    expect(findWildcardDomains(restrictVirtualHostDomains(ambiguous, TENANTS[0].host))).toEqual([
      "'*'",
    ])
    expect(() => buildSharedGateway([TENANTS[0]], ambiguous)).toThrow(GatewayIsolationError)
  })
})

describe('per-tenant keys are resolved, and never shared', () => {
  it('substitutes the tenant keys into the filters', () => {
    const resolved = substituteTenantSecrets(LDS_FRAGMENT, TENANTS[0].secrets)
    expect(resolved).toContain('AAAA-anon-key-aaaa')
    expect(resolved).toContain('AAAA-service-role-key-aaaa')
    expect(resolved).toContain('https://aclient.213.47.80.26.sslip.io')
    expect(findUnresolvedPlaceholders(resolved)).toEqual([])
  })

  it('leaves the platform-level dashboard credential for the shared entrypoint', () => {
    const resolved = substituteTenantSecrets(LDS_FRAGMENT, TENANTS[0].secrets)
    expect(resolved).toContain(`\${${PLATFORM_LEVEL_PLACEHOLDERS[0]}}`)
    expect(findUnresolvedPlaceholders(resolved)).toEqual([])
  })

  it('flags a tenant-scoped placeholder that survived substitution', () => {
    const half = LDS_FRAGMENT.replace('${SERVICE_ROLE_KEY}', '${SOME_UNKNOWN_KEY}')
    const resolved = substituteTenantSecrets(half, TENANTS[0].secrets)
    expect(findUnresolvedPlaceholders(resolved)).toEqual(['SOME_UNKNOWN_KEY'])
    expect(() => buildSharedGateway([TENANTS[0]], half)).toThrow(/unresolved tenant-scoped/)
  })

  it('refuses to build when one tenant is missing its keys', () => {
    const broken = [
      TENANTS[0],
      { slug: 'cclient-1003', host: 'cclient.213.47.80.26.sslip.io' } as never,
    ]
    expect(() => buildSharedGateway(broken, LDS_FRAGMENT)).toThrow()
  })

  it('detects a leaked key if one tenant ends up holding a foreign secret', () => {
    const gateway = buildSharedGateway(TENANTS, LDS_FRAGMENT)
    expect(findCrossTenantSecretLeaks(gateway.lds, TENANTS)).toEqual([])

    // Now contrive the failure: tenant B's fragment carrying A's key must be reported.
    const tampered = gateway.lds.replace(
      TENANTS[1].secrets.anonKey,
      TENANTS[0].secrets.anonKey
    )
    const leaks = findCrossTenantSecretLeaks(tampered, TENANTS)
    expect(leaks.length).toBeGreaterThan(0)
    expect(leaks[0].leaks).toContain(TENANTS[0].slug)
  })
})

describe('cluster references are namespaced per tenant', () => {
  it('rewrites every bare cluster reference', () => {
    const namespaced = namespaceClusterRefs(LDS_FRAGMENT, 'aclient-1001')
    expect(namespaced).toContain('cluster: aclient-1001-auth')
    expect(namespaced).toContain('cluster: aclient-1001-functions')
    expect(findClusterRefsNotOwnedBy(namespaced, 'aclient-1001')).toEqual([])
  })

  it('flags a reference that belongs to another tenant', () => {
    const leaked = 'route:\n  cluster: bclient-1002-auth\n'
    expect(findClusterRefsNotOwnedBy(leaked, 'aclient-1001')).toEqual(['bclient-1002-auth'])
  })

  it('builds one namespaced cluster per tenant service, with the real upstream ports', () => {
    const cds = buildSharedClusters(TENANTS)
    for (const tenant of TENANTS) {
      for (const upstream of TENANT_UPSTREAMS) {
        expect(cds).toContain(`name: ${tenantClusterName(tenant.slug, upstream.service)}`)
      }
    }
    expect(cds).toContain('port_value: 9999') // auth
    expect(cds).toContain('port_value: 3000') // rest
    expect(cds).toContain('port_value: 5000') // storage
    expect(cds).toContain('port_value: 4000') // realtime
    expect(cds).toContain('port_value: 9000') // functions
    expect(cds).not.toMatch(/^\s*name:\s*auth\s*$/m)
  })

  it('addresses every cluster by a namespaced alias, never a bare service name', () => {
    // With the shared gateway attached to several tenant networks that each define `auth`, `rest`,
    // `db`…, a bare name is ambiguous and could resolve into a sibling tenant. Every endpoint must
    // therefore carry its tenant prefix.
    //
    // `[ \t]` rather than `\s`: `\s` matches newlines, so `^\s*address:\s*(\S+)$` skips past a bare
    // `address:` line and captures the *next* line's `socket_address:` as the value.
    const cds = buildSharedClusters(TENANTS)
    const addresses = [...cds.matchAll(/^[ \t]*address:[ \t]*(\S+)[ \t]*$/gm)].map((m) => m[1])
    expect(addresses.length).toBe(TENANTS.length * TENANT_UPSTREAMS.length)
    for (const address of addresses) {
      // `contains`, not `startsWith`: realtime legitimately reads `realtime-dev.<slug>-realtime`.
      // What matters is that the name carries its tenant's slug, making it unique across every
      // network the shared gateway is attached to.
      expect(TENANTS.some((t) => address.includes(t.slug))).toBe(true)
    }
    // and specifically, no bare `auth` / `db` / `rest` endpoint survives
    for (const bare of ['auth', 'rest', 'db', 'storage', 'realtime', 'functions']) {
      expect(addresses).not.toContain(bare)
    }
  })

  it('exposes the alias map the tenant compose must publish', () => {
    const aliases = buildTenantAliases(TENANTS[0].slug)
    for (const upstream of TENANT_UPSTREAMS) {
      expect(aliases[upstream.service]).toBeDefined()
      expect(aliases[upstream.service]).toContain(TENANTS[0].slug)
    }
  })

  it('uses the real container names, not the compose service keys', () => {
    // Verified against the live containers: the template sets an explicit container_name for every
    // service, and that — not the compose key — is the Docker DNS alias. Using the key would emit a
    // config that resolves to nothing.
    const slug = 'drill-restore-164259-1789051379623'
    expect(tenantContainerName(slug, 'auth')).toBe(`${slug}-auth`)
    expect(tenantContainerName(slug, 'db')).toBe(`${slug}-db`)
    expect(tenantContainerName(slug, 'rest')).toBe(`${slug}-rest`)
    expect(tenantContainerName(slug, 'storage')).toBe(`${slug}-storage`)
    expect(tenantContainerName(slug, 'studio')).toBe(`${slug}-studio`)
    expect(tenantContainerName(slug, 'meta')).toBe(`${slug}-meta`)
    expect(tenantContainerName(slug, 'imgproxy')).toBe(`${slug}-imgproxy`)
    // the four that break the pattern
    expect(tenantContainerName(slug, 'api-gw')).toBe(`${slug}-envoy`)
    expect(tenantContainerName(slug, 'functions')).toBe(`${slug}-edge-functions`)
    expect(tenantContainerName(slug, 'supavisor')).toBe(`${slug}-pooler`)
    expect(tenantContainerName(slug, 'realtime')).toBe(`realtime-dev.${slug}-realtime`)
  })

  it('accepts the internal authority a Host-less caller must use', () => {
    // fetch() cannot set Host, so a caller reaching the gateway by IP:port presents
    // `:authority: 10.0.2.1:<port>`. Without this the listener matches no virtual host and denies.
    const withAuthority = buildSharedGateway(
      [
        { ...TENANTS[0], internalAuthorities: ['10.0.2.1:11130'] },
        { ...TENANTS[1], internalAuthorities: ['10.0.2.1:11131'] },
      ],
      LDS_FRAGMENT
    )
    expect(withAuthority.lds).toContain("'10.0.2.1:11130'")
    expect(withAuthority.lds).toContain("'10.0.2.1:11131'")

    // Each tenant gets only its own authority: the ports are distinct, so this stays isolated.
    const segments = withAuthority.lds.split('supabase-').slice(1)
    const first = segments.find((s) => s.includes('aclient'))
    const second = segments.find((s) => s.includes('bclient'))
    if (first) expect(first).not.toContain('10.0.2.1:11131')
    if (second) expect(second).not.toContain('10.0.2.1:11130')
  })
})

describe('one listener per tenant, each on its own port', () => {
  const gateway = buildSharedGateway(TENANTS, LDS_FRAGMENT, { basePort: 8100 })

  it('assigns each tenant a distinct port', () => {
    expect(gateway.ports[TENANTS[0].slug]).toBe(8100)
    expect(gateway.ports[TENANTS[1].slug]).toBe(8101)
    const assigned = Object.values(gateway.ports)
    expect(new Set(assigned).size).toBe(assigned.length)
  })

  it('emits exactly one Listener resource per tenant — not one, and not one per fragment plus a stray', () => {
    const listeners = (gateway.lds.match(/config\.listener\.v3\.Listener/g) ?? []).length
    expect(listeners).toBe(TENANTS.length)
  })

  it('has exactly one resources: header even though every fragment carries its own', () => {
    const headers = (gateway.lds.match(/^resources:\s*$/gm) ?? []).length
    expect(headers).toBe(1)
  })

  it('binds each listener to a unique port, so envoy cannot reject duplicate addresses', () => {
    const ports = [...gateway.lds.matchAll(/port_value:\s*(\d+)/g)].map((m) => m[1])
    // every declared port belongs to a tenant, and none is the template default
    for (const port of ports) {
      expect(['8100', '8101']).toContain(port)
    }
    expect(ports).not.toContain('8000')
  })

  it('names the listeners per tenant rather than all "supabase"', () => {
    expect(gateway.lds).toContain(`name: supabase-${TENANTS[0].slug}`)
    expect(gateway.lds).toContain(`name: supabase-${TENANTS[1].slug}`)
  })

  it('keeps the whole filter chain per tenant, keys included', () => {
    const segmentA = gateway.lds.slice(
      gateway.lds.indexOf(`name: supabase-${TENANTS[0].slug}`),
      gateway.lds.indexOf(`name: supabase-${TENANTS[1].slug}`)
    )
    expect(segmentA).toContain(TENANTS[0].secrets.anonKey)
    expect(segmentA).not.toContain(TENANTS[1].secrets.anonKey)
    // the JWT providers are per listener, which is exactly why they were not merged
    expect(segmentA).toContain('jwt_authn')
  })
})

describe('retargetListener', () => {
  it('renames the listener and rebinds its port', () => {
    const out = retargetListener(LDS_FRAGMENT, { name: 'supabase-x', port: 8123 })
    expect(out).toContain('name: supabase-x')
    expect(out).toContain('port_value: 8123')
    expect(out).not.toContain('port_value: 8000')
  })

  it('rejects an invalid port instead of emitting an invalid config', () => {
    expect(() => retargetListener(LDS_FRAGMENT, { name: 'x', port: 0 })).toThrow(
      GatewayIsolationError
    )
    expect(() => retargetListener(LDS_FRAGMENT, { name: 'x', port: 70000 })).toThrow(
      GatewayIsolationError
    )
  })
})

describe('buildSharedGateway', () => {
  const gateway = buildSharedGateway(TENANTS, LDS_FRAGMENT)

  it('produces one virtual host per tenant, each restricted to its own host', () => {
    for (const tenant of TENANTS) {
      expect(gateway.lds).toContain(`- '${tenant.host}'`)
    }
    expect(findWildcardDomains(gateway.lds)).toEqual([])
  })

  it('routes each tenant only to its own clusters and keys', () => {
    const segmentA = (gateway.lds.split(`- '${TENANTS[0].host}'`)[1] ?? '').split(
      `- '${TENANTS[1].host}'`
    )[0]
    expect(segmentA).toContain(`cluster: ${TENANTS[0].slug}-auth`)
    expect(segmentA).toContain(TENANTS[0].secrets.anonKey)
    expect(segmentA).not.toContain(`${TENANTS[1].slug}-`)
    expect(segmentA).not.toContain(TENANTS[1].secrets.anonKey)
  })

  it('namespaces every cluster reference in the assembled listener', () => {
    const refs = [...gateway.lds.matchAll(/\bcluster:\s*(\S+)/g)].map((m) =>
      m[1].replace(/['"]/g, '')
    )
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(TENANTS.some((t) => ref.startsWith(`${t.slug}-`))).toBe(true)
    }
  })

  it('rejects duplicate slugs', () => {
    expect(() =>
      buildSharedGateway([TENANTS[0], { ...TENANTS[1], slug: TENANTS[0].slug }], LDS_FRAGMENT)
    ).toThrow(/Duplicate tenant slug/)
  })

  it('rejects an empty tenant list', () => {
    expect(() => buildSharedGateway([], LDS_FRAGMENT)).toThrow(/no tenants/)
  })
})
