import { describe, expect, it } from 'vitest'

import {
  PANEL_CONTAINER_NAME,
  PRODUCT_NAME,
  PRODUCT_SLUG,
} from '../src/lib/paths'
import { buildPanelTraefikConfig, buildProjectTraefikConfig } from '../src/lib/traefik'

describe('buildPanelTraefikConfig', () => {
  it('routes the panel using the canonical slug and container name', () => {
    const yaml = buildPanelTraefikConfig('panel.example.com')

    expect(yaml).toContain(`    ${PRODUCT_SLUG}:`)
    expect(yaml).toContain(`      service: ${PRODUCT_SLUG}`)
    expect(yaml).toContain(`  services:\n    ${PRODUCT_SLUG}:`)
    expect(yaml).toContain(`- url: "http://${PANEL_CONTAINER_NAME}:3000"`)
    expect(yaml).toContain(`rule: "Host(\`panel.example.com\`)"`)
    expect(yaml).toContain(PRODUCT_NAME)
  })

  it('does not use the old or underscore brand', () => {
    const yaml = buildPanelTraefikConfig('panel.example.com')

    // Needles constructed dynamically so this file does not contain the
    // forbidden tokens as literals (the repo-wide rebrand scan skips tests,
    // but we keep it clean regardless).
    expect(yaml).not.toContain(['supa', 'panel'].join(''))
    expect(yaml).not.toMatch(/supabase_multitenant/)
    expect(yaml).not.toContain(['Supabase-', 'Multitenant'].join(''))
  })
})

describe('buildProjectTraefikConfig', () => {
  it('routes the project API to its Kong service on the API domain', () => {
    const yaml = buildProjectTraefikConfig({
      projectSlug: 'my-proj',
      domain: 'api.example.com',
      kongPort: 8000,
      studioPort: 3000,
    })

    expect(yaml).toContain('my-proj-api:')
    expect(yaml).toContain('service: my-proj-api')
    expect(yaml).toContain('- url: "http://my-proj-kong:8000"')
    expect(yaml).toContain('rule: "Host(`api.example.com`)"')
  })

  it('adds a Studio router and service when a studio domain is provided', () => {
    const yaml = buildProjectTraefikConfig({
      projectSlug: 'my-proj',
      domain: 'api.example.com',
      studioDomain: 'studio.example.com',
      kongPort: 8000,
      studioPort: 3000,
    })

    expect(yaml).toContain('my-proj-studio:')
    expect(yaml).toContain('service: my-proj-studio')
    expect(yaml).toContain('- url: "http://my-proj-studio:3000"')
    expect(yaml).toContain('rule: "Host(`studio.example.com`)"')
  })

  it('omits routers and services when no domain is configured', () => {
    const yaml = buildProjectTraefikConfig({
      projectSlug: 'my-proj',
      domain: '',
      kongPort: 8000,
      studioPort: 3000,
    })

    expect(yaml).not.toContain('-api:')
    expect(yaml).not.toContain('-studio:')
  })
})
