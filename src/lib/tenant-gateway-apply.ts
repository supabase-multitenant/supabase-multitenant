/**
 * Applying the shared gateway: this is the half of `tenant-gateway.ts` that touches the machine.
 *
 * The gateway is ONE envoy process for every tenant. Adding a tenant means three things, and they
 * must happen together or a tenant ends up half-connected:
 *
 *   1. its network must be joined (so the gateway can reach its services, and the tenant can reach
 *      the gateway as `<slug>-gw`),
 *   2. the gateway's clusters + listeners must be rewritten to include every tenant,
 *   3. the gateway must reload, or it keeps serving the old topology.
 *
 * Regenerating the whole file from the database on every change is deliberate: the config is
 * derived, never hand-edited, so it cannot drift away from what the panel believes exists.
 */
import { exec } from 'child_process'
import { promises as fs } from 'fs'
import * as path from 'path'
import { promisify } from 'util'

import { prisma } from './db'
import { buildSharedGateway, type TenantGatewayInput } from './gateway'
import { getCoreBasePath } from './paths'
import {
  TENANT_LISTENER_PORT_BASE,
  apiHostFor,
  platformBaseDomain,
  slotFromEnv,
  tenantSlot,
} from './tenant-gateway'

const execAsync = promisify(exec)

/** The one envoy container every tenant shares. */
export const GATEWAY_CONTAINER = 'smbt-shared-gateway'

/** Where the gateway reads its config from (a host path; the panel has /data mounted). */
export const GATEWAY_CONFIG_DIR = '/data/shared/gateway/envoy'

/** The per-tenant listener blueprint shipped with the core stack. */
export function ldsTemplatePath(): string {
  return path.join(getCoreBasePath(), 'docker/volumes/api/envoy/lds.template.yaml')
}

export interface ProjectForGateway {
  slug: string
  /** The project row's stored env vars, keyed by name. */
  env: Record<string, string>
}

/**
 * Turn stored projects into gateway tenants.
 *
 * A project with no slot is *skipped and reported*, never defaulted: guessing a slot would put two
 * tenants on one listener, which reads as one tenant answering another's hostname.
 */
export function tenantInputsFromProjects(
  projects: ProjectForGateway[],
  baseDomain: string
): { tenants: TenantGatewayInput[]; skipped: string[] } {
  const tenants: TenantGatewayInput[] = []
  const skipped: string[] = []

  for (const project of projects) {
    const slot = slotFromEnv(project.env)
    if (slot === null) {
      skipped.push(project.slug)
      continue
    }
    const anonKey = project.env.ANON_KEY
    const serviceRoleKey = project.env.SERVICE_ROLE_KEY
    if (!anonKey || !serviceRoleKey) {
      skipped.push(project.slug)
      continue
    }

    const host = apiHostFor(project.slug, baseDomain)
    tenants.push({
      slug: project.slug,
      host,
      port: tenantSlot(slot).listenerPort,
      secrets: { anonKey, serviceRoleKey, publicUrl: `https://${host}` },
    })
  }

  return { tenants, skipped }
}

/** Every project the panel knows about, as `slug` + its stored env. */
export async function projectsForGateway(): Promise<ProjectForGateway[]> {
  const rows = await prisma.project.findMany({
    where: { status: { not: 'deleted' } },
    select: { slug: true, envVars: { select: { key: true, value: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return rows.map((row) => ({
    slug: row.slug,
    env: Object.fromEntries(row.envVars.map((v) => [v.key, v.value])),
  }))
}

/** Join the gateway to a tenant's compose network, as `<slug>-gw`, so both can reach each other. */
export async function connectTenantNetwork(slug: string): Promise<void> {
  const network = `${slug}_default`
  try {
    await execAsync(
      `docker network connect --alias ${slug}-gw ${GATEWAY_CONTAINER} ${network}`,
      { timeout: 30_000 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Already joined is the normal case on re-sync; anything else is worth knowing about.
    if (!/already exists/i.test(message)) {
      throw new Error(`Could not join ${GATEWAY_CONTAINER} to ${network}: ${message}`)
    }
  }
}

/** Rewrite the gateway's clusters and listeners from the database. */
export async function writeGatewayConfig(
  tenants: TenantGatewayInput[]
): Promise<Record<string, number>> {
  const template = await fs.readFile(ldsTemplatePath(), 'utf8')
  const { cds, lds, ports } = buildSharedGateway(tenants, template, {
    basePort: TENANT_LISTENER_PORT_BASE,
  })

  await fs.mkdir(GATEWAY_CONFIG_DIR, { recursive: true })
  await fs.writeFile(path.join(GATEWAY_CONFIG_DIR, 'cds.yaml'), cds)
  await fs.writeFile(path.join(GATEWAY_CONFIG_DIR, 'lds.yaml'), lds)

  return ports
}

/** Make the gateway re-read its config. */
export async function reloadGateway(): Promise<void> {
  await execAsync(`docker restart ${GATEWAY_CONTAINER}`, { timeout: 60_000 })
}

/**
 * Bring the gateway in line with the database: join, rewrite, reload.
 *
 * Returns the ports each tenant ended up on, plus the projects that could not be included — the
 * caller reports those rather than silently dropping a tenant.
 */
export async function syncSharedGateway(): Promise<{
  tenants: number
  ports: Record<string, number>
  skipped: string[]
}> {
  const baseDomain = platformBaseDomain(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL)
  if (!baseDomain) {
    throw new Error('Cannot build tenant hostnames: AUTH_URL is not set')
  }

  const { tenants, skipped } = tenantInputsFromProjects(await projectsForGateway(), baseDomain)

  if (tenants.length === 0) {
    // An empty tenant list would produce a gateway that answers nothing at all; leave the last
    // good config in place and let the caller surface the skipped list.
    return { tenants: 0, ports: {}, skipped }
  }

  for (const tenant of tenants) {
    await connectTenantNetwork(tenant.slug)
  }

  const ports = await writeGatewayConfig(tenants)
  await reloadGateway()

  return { tenants: tenants.length, ports, skipped }
}
