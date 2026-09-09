import { promises as fs } from 'fs'
import * as path from 'path'

import {
  PANEL_CONTAINER_NAME,
  PRODUCT_NAME,
  PRODUCT_SLUG,
  getTraefikDynamicPath,
} from './paths'

/**
 * Traefik dynamic configuration generator for Supabase Multitenant projects
 * Creates routing rules for each project's custom domain
 */

interface TraefikConfig {
  projectSlug: string
  domain: string        // API domain (Kong)
  studioDomain?: string // Studio domain (optional, separate from API)
  kongPort: number
  studioPort: number
}

/**
 * Build the Traefik routing YAML for a single Supabase project.
 * Pure function: does not touch the filesystem.
 */
export function buildProjectTraefikConfig(config: TraefikConfig): string {
  const { projectSlug, domain, studioDomain, kongPort, studioPort } = config

  // Build routers section based on which domains are configured
  let routersConfig = ''
  let servicesConfig = ''

  // API domain configuration
  if (domain) {
    routersConfig += `
    # Main API router (Kong gateway)
    ${projectSlug}-api:
      rule: "Host(\`${domain}\`)"
      entryPoints:
        - websecure
      service: ${projectSlug}-api
      tls:
        certResolver: letsencrypt
      priority: 10
    
    # HTTP redirect for API
    ${projectSlug}-api-http:
      rule: "Host(\`${domain}\`)"
      entryPoints:
        - web
      middlewares:
        - https-redirect
      service: ${projectSlug}-api
      priority: 5`

    servicesConfig += `
    ${projectSlug}-api:
      loadBalancer:
        servers:
          - url: "http://${projectSlug}-kong:${kongPort}"
        healthCheck:
          path: /health
          interval: 30s
          timeout: 5s`
  }

  // Studio domain configuration
  if (studioDomain) {
    routersConfig += `
    
    # Studio router
    ${projectSlug}-studio:
      rule: "Host(\`${studioDomain}\`)"
      entryPoints:
        - websecure
      service: ${projectSlug}-studio
      tls:
        certResolver: letsencrypt
      priority: 10
    
    # HTTP redirect for Studio
    ${projectSlug}-studio-http:
      rule: "Host(\`${studioDomain}\`)"
      entryPoints:
        - web
      middlewares:
        - https-redirect
      service: ${projectSlug}-studio
      priority: 5`

    servicesConfig += `
    
    ${projectSlug}-studio:
      loadBalancer:
        servers:
          - url: "http://${projectSlug}-studio:${studioPort}"`
  }

  return `# Auto-generated Traefik routing for project: ${projectSlug}
# API Domain: ${domain || 'not configured'}
# Studio Domain: ${studioDomain || 'not configured'}
# Generated at: ${new Date().toISOString()}

http:
  routers:${routersConfig}

  middlewares:
    https-redirect:
      redirectScheme:
        scheme: https
        permanent: true

  services:${servicesConfig}
`
}

/**
 * Generate Traefik routing configuration for a Supabase project
 * Supports separate domains for API (Kong) and Studio
 */
export async function generateProjectTraefikConfig(config: TraefikConfig): Promise<void> {
  const { projectSlug } = config

  const traefikConfig = buildProjectTraefikConfig(config)

  const configPath = path.join(getTraefikDynamicPath(), `${projectSlug}.yml`)

  // Ensure directory exists
  await fs.mkdir(getTraefikDynamicPath(), { recursive: true })

  // Write the config file
  await fs.writeFile(configPath, traefikConfig)

  console.log(`Traefik config generated for project ${projectSlug} at ${configPath}`)
}

/**
 * Update an existing project's Traefik config with a new domain
 */
export async function updateProjectDomain(
  projectSlug: string,
  newDomain: string,
  kongPort: number,
  studioPort: number
): Promise<void> {
  await generateProjectTraefikConfig({
    projectSlug,
    domain: newDomain,
    kongPort,
    studioPort,
  })
}

/**
 * Remove Traefik configuration for a deleted project
 */
export async function removeProjectTraefikConfig(projectSlug: string): Promise<void> {
  const configPath = path.join(getTraefikDynamicPath(), `${projectSlug}.yml`)

  try {
    await fs.unlink(configPath)
    console.log(`Traefik config removed for project ${projectSlug}`)
  } catch (error) {
    // File may not exist if project never had a custom domain
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to remove Traefik config for ${projectSlug}:`, error)
    }
  }
}

/**
 * Get the ports used by a project's services from environment variables
 */
export function getProjectPorts(envVars: Record<string, string>): { kongPort: number; studioPort: number } {
  return {
    kongPort: parseInt(envVars.KONG_HTTP_PORT || '8000', 10),
    studioPort: parseInt(envVars.STUDIO_PORT || '3000', 10),
  }
}

/**
 * Check if a domain is properly pointed to this server (basic DNS check)
 * Returns true if the domain resolves to an IP that could be this server
 */
export async function verifyDomainDNS(domain: string): Promise<boolean> {
  try {
    // Use Node's DNS module for resolution
    const dns = await import('dns').then(m => m.promises)
    const addresses = await dns.resolve4(domain)

    // Domain resolves to at least one IP
    return addresses.length > 0
  } catch {
    // DNS resolution failed
    return false
  }
}

/**
 * Build the Traefik routing YAML for the Supabase Multitenant panel itself.
 * Pure function: does not touch the filesystem.
 */
export function buildPanelTraefikConfig(domain: string): string {
  return `# Auto-generated Traefik routing for ${PRODUCT_NAME}
# Domain: ${domain}
# Generated at: ${new Date().toISOString()}

http:
  routers:
    # Panel HTTPS router
    ${PRODUCT_SLUG}:
      rule: "Host(\`${domain}\`)"
      entryPoints:
        - websecure
      service: ${PRODUCT_SLUG}
      tls:
        certResolver: letsencrypt
      priority: 100
    
    # Panel HTTP redirect router
    ${PRODUCT_SLUG}-http:
      rule: "Host(\`${domain}\`)"
      entryPoints:
        - web
      middlewares:
        - https-redirect
      service: ${PRODUCT_SLUG}
      priority: 50

  middlewares:
    https-redirect:
      redirectScheme:
        scheme: https
        permanent: true

  services:
    ${PRODUCT_SLUG}:
      loadBalancer:
        servers:
          - url: "http://${PANEL_CONTAINER_NAME}:3000"
`
}

/**
 * Generate Traefik routing configuration for the Supabase Multitenant panel
 */
export async function generatePanelTraefikConfig(domain: string): Promise<void> {
  const traefikConfig = buildPanelTraefikConfig(domain)

  const configPath = path.join(getTraefikDynamicPath(), 'panel.yml')

  // Ensure directory exists
  await fs.mkdir(getTraefikDynamicPath(), { recursive: true })

  // Write the config file
  await fs.writeFile(configPath, traefikConfig)

  console.log(`Panel Traefik config generated at ${configPath}`)
}

/**
 * Remove Traefik configuration for the panel domain
 */
export async function removePanelTraefikConfig(): Promise<void> {
  const configPath = path.join(getTraefikDynamicPath(), 'panel.yml')

  try {
    // Write empty config (just a comment)
    const emptyConfig = `# ${PRODUCT_NAME} Panel Routing
# No custom domain configured - access via IP:3000
`
    await fs.writeFile(configPath, emptyConfig)
    console.log(`Panel Traefik config cleared at ${configPath}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to remove panel Traefik config:', error)
    }
  }
}
