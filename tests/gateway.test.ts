import { describe, expect, it } from 'vitest'

import {
  GatewayIsolationError,
  TENANT_UPSTREAMS,
  buildSharedClusters,
  buildSharedGateway,
  findClusterRefsNotOwnedBy,
  findWildcardDomains,
  namespaceClusterRefs,
  restrictVirtualHostDomains,
  tenantClusterName,
} from '@/lib/gateway'

/**
 * Trimmed but structurally faithful copy of the real `lds.template.yaml`: one listener, one
 * virtual host, `domains: ['*']`, routes to the bare cluster names, and — importantly for the
 * domain rewrite — further lists (`cors`, `request_headers_to_add`) at other indents that must
 * not be touched.
 */
const LDS_FRAGMENT = `    - filters:
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
`

const TENANTS = [
  { slug: 'aclient-1001', host: 'aclient.213.47.80.26.sslip.io' },
  { slug: 'bclient-1002', host: 'bclient.213.47.80.26.sslip.io' },
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
    // cors and request_headers_to_add are lists too, at other indents
    expect(restricted).toContain('allow_methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD"')
    expect(restricted).toContain('key: X-Forwarded-Host')
    expect(restricted).toContain('regex: ".*"')
    expect(restricted.split('\n').length).toBeGreaterThanOrEqual(LDS_FRAGMENT.split('\n').length)
  })

  it('refuses to build for a wildcard host', () => {
    expect(() => restrictVirtualHostDomains(LDS_FRAGMENT, '*')).toThrow(GatewayIsolationError)
    expect(() => restrictVirtualHostDomains(LDS_FRAGMENT, '*.example.com')).toThrow(
      GatewayIsolationError
    )
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
    // the shared CDS must contain no un-namespaced cluster at all
    expect(cds).not.toMatch(/^\s*name:\s*auth\s*$/m)
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

  it('routes each tenant only to its own clusters', () => {
    // Tenant A's host must never appear adjacent to tenant B's clusters. Strongest available
    // structural check without an envoy instance: split the document per tenant domain.
    const [, afterA] = gateway.lds.split(`- '${TENANTS[0].host}'`)
    const segmentA = afterA?.split(`- '${TENANTS[1].host}'`)[0] ?? ''
    expect(segmentA).toContain(`cluster: ${TENANTS[0].slug}-auth`)
    expect(segmentA).not.toContain(`${TENANTS[1].slug}-`)
  })

  it('namespaces every cluster reference in the assembled listener', () => {
    const refs = [...gateway.lds.matchAll(/\bcluster:\s*(\S+)/g)].map((m) => m[1].replace(/['"]/g, ''))
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

  it('handles flow-style domains rather than assuming the block form', () => {
    const inline = LDS_FRAGMENT.replace(
      "                  domains:\n                    - '*'",
      "                  domains: ['*']"
    )
    const restricted = restrictVirtualHostDomains(inline, TENANTS[0].host)
    expect(findWildcardDomains(restricted)).toEqual([])
    expect(restricted).toContain(`[${["'" + TENANTS[0].host + "'", "'" + TENANTS[0].host + ":*'"].join(', ')}]`)
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
