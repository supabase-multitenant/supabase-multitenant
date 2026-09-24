/**
 * On-demand service groups (ADR-0003, phase 4).
 *
 * A project's compose can contain nine services, but a project that only uses Postgres and Auth is
 * paying for `realtime` (measured 230–260 MiB), `storage` (110–180 MiB), `studio` (~200 MiB) and
 * `meta` (~112 MiB) on nothing. Those are the "repeat waste" services: every instance carries its
 * own copy whether or not anybody uses it.
 *
 * This module makes the per-instance footprint follow actual use:
 *
 *   core       db, auth, rest            always on — without them there is no Supabase
 *   realtime   realtime                  when the project subscribes to changes
 *   storage    storage, imgproxy         when the project stores files
 *   functions  functions                 when the project runs edge functions
 *   dashboard  studio, meta              when somebody opens the Studio
 *
 * `dashboard` is deliberately on-demand rather than always-on: Studio is only needed while a human
 * is looking at it, and it is the single most expensive optional group.
 *
 * The enabled set is stored as a project env var (`ENABLED_SERVICES`) rather than a new column, so
 * this needs no schema migration and can be read by the same code path that reads every other
 * project setting.
 */

import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/** Group name -> the compose service names it covers. */
export const SERVICE_GROUPS: Record<string, string[]> = {
  core: ['db', 'auth', 'rest'],
  realtime: ['realtime'],
  // storage cannot serve images without imgproxy; they travel together.
  storage: ['storage', 'imgproxy'],
  functions: ['functions'],
  dashboard: ['studio', 'meta'],
}

export const SERVICE_GROUP_NAMES = Object.keys(SERVICE_GROUPS)

/** Always present, never optional. */
export const ALWAYS_ON_GROUPS = ['core'] as const

export class ServiceGroupError extends Error {
  constructor(
    message: string,
    readonly detail: string[] = []
  ) {
    super(message)
    this.name = 'ServiceGroupError'
  }
}

/** The env var that records what a project wants running. */
export const ENABLED_SERVICES_KEY = 'ENABLED_SERVICES'

/**
 * Parse the `ENABLED_SERVICES` value.
 *
 * Unknown names are rejected rather than ignored: silently dropping a typo would produce a project
 * that quietly lacks a service it believes it has.
 */
export function parseEnabledGroups(value: string | undefined | null): string[] {
  if (value === undefined || value === null || value.trim() === '') {
    return [...ALWAYS_ON_GROUPS]
  }
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const unknown = parts.filter((p) => !SERVICE_GROUP_NAMES.includes(p))
  if (unknown.length > 0) {
    throw new ServiceGroupError(
      `Unknown service group(s): ${unknown.join(', ')}. Known: ${SERVICE_GROUP_NAMES.join(', ')}`,
      unknown
    )
  }
  // core is always included, however the value was stored.
  return [...new Set([...ALWAYS_ON_GROUPS, ...parts])]
}

export function serializeEnabledGroups(groups: string[]): string {
  const unknown = groups.filter((g) => !SERVICE_GROUP_NAMES.includes(g))
  if (unknown.length > 0) {
    throw new ServiceGroupError(`Unknown service group(s): ${unknown.join(', ')}`, unknown)
  }
  return [...new Set([...ALWAYS_ON_GROUPS, ...groups])].join(',')
}

/** Compose service names for a set of groups. */
export function composeServicesFor(groups: string[]): string[] {
  const out: string[] = []
  for (const group of groups) {
    const services = SERVICE_GROUPS[group]
    if (!services) {
      throw new ServiceGroupError(`Unknown service group: ${group}`, [group])
    }
    out.push(...services)
  }
  return [...new Set(out)]
}

/** The compose services that should NOT be running for a given enabled set. */
export function servicesToStop(enabledGroups: string[]): string[] {
  // Core is forced into the wanted set even if the caller forgot it. Without this,
  // `servicesToStop(['realtime'])` computes core as unwanted and returns db, auth and rest to stop —
  // i.e. it would shut down the database. The always-on groups are not negotiable, so this function
  // must not be able to express stopping them.
  const wanted = new Set(composeServicesFor([...ALWAYS_ON_GROUPS, ...enabledGroups]))
  const all = new Set(Object.values(SERVICE_GROUPS).flat())
  return [...all].filter((s) => !wanted.has(s)).sort()
}

/** Every group a project could enable, for the UI. */
export function groupCatalog(): Array<{ name: string; services: string[]; optional: boolean }> {
  return SERVICE_GROUP_NAMES.map((name) => ({
    name,
    services: SERVICE_GROUPS[name],
    optional: !ALWAYS_ON_GROUPS.includes(name as (typeof ALWAYS_ON_GROUPS)[number]),
  }))
}

export interface ApplyGroupsOptions {
  projectDir: string
  /** Groups the project wants running. */
  groups: string[]
  /**
   * Start the wanted services and stop the rest. `docker compose start|stop <service>` acts on the
   * existing containers, so this is seconds rather than a rebuild, and it preserves volumes.
   */
  timeoutMs?: number
}

export interface ApplyGroupsResult {
  started: string[]
  stopped: string[]
  /** Services skipped because they are not in this project's compose at all. */
  absent: string[]
}

/**
 * Bring a project's running services in line with its enabled groups.
 *
 * Idempotent: starting an already-running service and stopping an already-stopped one are both
 * no-ops for compose. That matters because the Studio route calls this on every page load.
 */
export async function applyServiceGroups(options: ApplyGroupsOptions): Promise<ApplyGroupsResult> {
  const { projectDir, groups } = options
  const timeout = options.timeoutMs ?? 120000

  const present = await composeServicesPresent(projectDir, timeout)
  const wanted = composeServicesFor(groups).filter((s) => present.has(s))
  const unwanted = servicesToStop(groups).filter((s) => present.has(s))

  const absent = [
    ...composeServicesFor(groups).filter((s) => !present.has(s)),
  ]

  let started: string[] = []
  let stopped: string[] = []

  if (wanted.length > 0) {
    await compose(projectDir, ['up', '-d', ...wanted], timeout)
    started = wanted
  }
  if (unwanted.length > 0) {
    await compose(projectDir, ['stop', ...unwanted], timeout)
    stopped = unwanted
  }

  return { started, stopped, absent }
}

/** Compose service names declared in the project's compose file. */
export async function composeServicesPresent(
  projectDir: string,
  timeoutMs = 60000
): Promise<Set<string>> {
  const { stdout } = await compose(projectDir, ['config', '--services'], timeoutMs)
  return new Set(
    stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  )
}

async function compose(
  projectDir: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(`docker compose ${args.join(' ')}`, {
      cwd: projectDir,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    })
    return { stdout, stderr }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ServiceGroupError(
      `docker compose ${args.slice(0, 2).join(' ')} failed in ${path.basename(projectDir)}: ${message}`,
      [message]
    )
  }
}
