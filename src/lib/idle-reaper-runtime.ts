/**
 * The live half of the idle reaper: reads the projects, inspects docker, stops what is idle.
 *
 * The decision logic is in `idle-reaper.ts` and knows nothing about databases or containers; this
 * file is the only part that touches them. Kept apart so the rule about *what may be stopped* can be
 * tested without a running platform.
 *
 * Started once from `src/instrumentation.ts`. Deliberately in-process rather than a scheduled job
 * outside the app: the thing being managed is the app's own service groups, and a panel that is not
 * running has no services to reap. There is no separate scheduler to keep alive, to secure, or to
 * discover later.
 *
 * Configuration (all optional, all read once at start):
 *   IDLE_REAPER_DISABLED=1        turn it off entirely
 *   IDLE_REAPER_MINUTES=30        how long a group must be idle before it is stopped
 *   IDLE_REAPER_INTERVAL_MINUTES=5  how often to look
 */

import { exec } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import { prisma } from '@/lib/db'
import { tenantContainerName } from '@/lib/gateway'
import { getProjectsBasePath } from '@/lib/paths'
import {
  ENABLED_SERVICES_KEY,
  applyServiceGroups,
  parseEnabledGroups,
} from '@/lib/service-groups'
import {
  DEFAULT_IDLE_MS,
  EPHEMERAL_GROUPS,
  UsageTracker,
  reapOnce,
  startIdleReaper,
  type IdleReaperDeps,
} from '@/lib/idle-reaper'

const execAsync = promisify(exec)

/**
 * The single tracker for this process. The Studio route records use against it, the reaper reads it.
 */
export const dashboardUsage = new UsageTracker()

/** Record that a human is looking at a project's dashboard right now. */
export function recordDashboardUse(projectId: string): void {
  for (const group of EPHEMERAL_GROUPS) dashboardUsage.record(projectId, group)
}

async function containerIsRunning(name: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker inspect --format '{{.State.Running}}' ${name}`, {
      timeout: 10000,
    })
    return stdout.trim() === 'true'
  } catch {
    // No such container, or docker is unreachable. Either way it is not running.
    return false
  }
}

async function enabledGroupsFor(projectId: string): Promise<string[]> {
  const rows = await prisma.projectEnvVar.findMany({
    where: { projectId, key: ENABLED_SERVICES_KEY },
    select: { value: true },
  })
  try {
    return parseEnabledGroups(rows[0]?.value)
  } catch {
    // A stored value with an unknown group is the project's problem to fix in the UI; it must not
    // stop us from reaping other projects, and guessing a set here could stop a wanted service.
    return ['core']
  }
}

export function createDeps(): IdleReaperDeps {
  return {
    now: () => Date.now(),

    async listProjects() {
      const projects = await prisma.project.findMany({
        where: { status: { not: 'deleted' } },
        select: { id: true, slug: true },
      })
      return projects
    },

    async runningEphemeral(projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { slug: true },
      })
      if (!project) return []

      const running: string[] = []
      for (const group of EPHEMERAL_GROUPS) {
        // One representative container per group is enough: the group is either up or it is not,
        // and asking about every container would multiply docker calls for no extra certainty.
        const service = group === 'dashboard' ? 'studio' : group
        if (await containerIsRunning(tenantContainerName(project.slug, service))) {
          running.push(group)
        }
      }
      return running
    },

    async stopGroups(projectId, groups) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, slug: true },
      })
      if (!project) return

      const enabled = await enabledGroupsFor(projectId)
      // Removing the reaped groups from the wanted set is what stops them: applying the remaining
      // set stops everything else, and `servicesToStop` will never include core.
      const wanted = enabled.filter((g) => !groups.includes(g))

      await applyServiceGroups({
        projectDir: path.join(getProjectsBasePath(), project.slug, 'docker'),
        groups: wanted,
        // A reap is background housekeeping; it must never hold a request open or pile up.
        timeoutMs: 60000,
      })

      // Forget the timestamps so a stopped group cannot be "stopped again" on the next pass.
      for (const group of groups) dashboardUsage.record(projectId, group, 0)
    },

    log(message) {
      console.log(`[idle-reaper] ${message}`)
    },
  }
}

let started = false

/**
 * Start the reaper if it should run. Safe to call more than once — instrumentation hooks can fire
 * per runtime, and starting two timers would double-stop the same groups.
 */
export function startOnce(): (() => void) | null {
  if (process.env.IDLE_REAPER_DISABLED === '1') {
    console.log('[idle-reaper] disabled by IDLE_REAPER_DISABLED')
    return null
  }
  if (started) return null
  started = true

  const idleMinutes = Number(process.env.IDLE_REAPER_MINUTES ?? '') || DEFAULT_IDLE_MS / 60000
  const intervalMinutes = Number(process.env.IDLE_REAPER_INTERVAL_MINUTES ?? '') || 5

  console.log(
    `[idle-reaper] watching ${EPHEMERAL_GROUPS.join(', ')} — stopping after ${idleMinutes} min idle, checking every ${intervalMinutes} min`
  )

  return startIdleReaper(createDeps(), dashboardUsage, {
    idleMs: idleMinutes * 60 * 1000,
    intervalMs: intervalMinutes * 60 * 1000,
  })
}
