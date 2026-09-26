/**
 * The other half of on-demand services: stopping what nobody is using.
 *
 * `service-groups.ts` starts a group when a request needs it. It never stops anything, so a group
 * that was genuinely needed once stays up forever. Measured on the live box: opening Studio for
 * three projects left three copies of studio + meta + functions resident, and the footprint grew
 * from 1.24 GiB to ~2.4 GiB with nobody using any of them. "Start on demand" without "stop when
 * idle" is not efficiency, it is just deferred waste.
 *
 * The rule that matters here is *which* groups may be stopped, and it is not "whatever is idle":
 *
 *   - `realtime`, `storage`, `functions` are running because a person **enabled** them. They are
 *     part of that project's contract, and stopping an idle-but-wanted service would break a
 *     customer's API to save memory — the API does not stop being called because nobody has opened
 *     the dashboard. Not eligible, ever.
 *   - `core` is not eligible, ever.
 *   - `dashboard` (studio + meta) exists only while a human is looking at it, it is the most
 *     expensive optional group, and it is what "on demand" was designed for. This is the target.
 *
 * So reaping is deliberately narrow. It is not a resource manager; it is the closing bracket of a
 * single on-demand group.
 *
 * Pure: no database, no docker, no clock of its own. The wiring lives in `idle-reaper-runtime.ts`
 * so this file can be reasoned about and tested without a live box.
 */

/** Groups that exist only while somebody is looking at them. The only reapable groups. */
export const EPHEMERAL_GROUPS = ['dashboard'] as const

export type EphemeralGroup = (typeof EPHEMERAL_GROUPS)[number]

/** Default idle window before an ephemeral group is stopped. */
export const DEFAULT_IDLE_MS = 30 * 60 * 1000

export interface GroupUsage {
  /** Group name, as used by service-groups.ts. */
  group: string
  /** When this group was last actually used, in epoch ms. */
  lastUsedAt: number
}

/**
 * Which groups to stop right now.
 *
 * Only ephemeral groups are ever returned, and only those idle for at least `idleMs`. Returning a
 * group that is not running is harmless — the caller's stop is a no-op — so this asks only "does
 * this deserve to be running?", never "is it running?".
 */
export function decideIdleStops(
  usage: GroupUsage[],
  options: { now: number; idleMs?: number }
): string[] {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  return usage
    .filter((u) => (EPHEMERAL_GROUPS as readonly string[]).includes(u.group))
    .filter((u) => options.now - u.lastUsedAt >= idleMs)
    .map((u) => u.group)
    .sort()
}

/**
 * Tracks when each group of each project was last used.
 *
 * Deliberately in-process rather than in the database. Losing it on restart is the safe direction:
 * a forgotten timestamp means "not known to be idle", and the reaper only stops what it positively
 * knows is idle — so a restart can delay a stop, never trigger a wrong one while somebody is mid-use.
 * Persisting it would need a schema change, and required columns crash-loop the panel (#75) for the
 * sake of a cache.
 */
export class UsageTracker {
  private readonly lastUsed = new Map<string, number>()

  constructor(private readonly now: () => number = Date.now) {}

  record(projectId: string, group: string, at?: number): void {
    this.lastUsed.set(this.key(projectId, group), at ?? this.now())
  }

  lastUsedAt(projectId: string, group: string): number | null {
    return this.lastUsed.get(this.key(projectId, group)) ?? null
  }

  /** Usage rows for one project, limited to groups with a known timestamp. */
  usageFor(projectId: string, groups: string[]): GroupUsage[] {
    const out: GroupUsage[] = []
    for (const group of groups) {
      const at = this.lastUsedAt(projectId, group)
      if (at !== null) out.push({ group, lastUsedAt: at })
    }
    return out
  }

  forget(projectId: string): void {
    const prefix = `${projectId}:`
    for (const key of [...this.lastUsed.keys()]) {
      if (key.startsWith(prefix)) this.lastUsed.delete(key)
    }
  }

  private key(projectId: string, group: string): string {
    return `${projectId}:${group}`
  }
}

/** What the reaper needs from the outside world. Injected so it can be tested without one. */
export interface IdleReaperDeps {
  now(): number
  /** Ephemeral groups currently running for a project. */
  runningEphemeral(projectId: string): Promise<string[]>
  /** Stop these groups for this project. */
  stopGroups(projectId: string, groups: string[]): Promise<void>
  /** Projects to consider, with their slugs. */
  listProjects(): Promise<Array<{ id: string; slug: string }>>
  log(message: string): void
}

export interface ReapOutcome {
  projectId: string
  slug: string
  stopped: string[]
}

/**
 * One pass. Stops every ephemeral group that is both running and positively known to be idle.
 *
 * A project whose ephemeral groups are running but have no recorded timestamp is skipped: unknown is
 * treated as "in use". That is the conservative direction — the cost of a wrong stop is a user
 * staring at a cold-start, the cost of a missed stop is a few hundred megabytes.
 *
 * One project failing must not stop the pass: a project with a broken compose should not prevent
 * reaping the other four.
 */
export async function reapOnce(
  deps: IdleReaperDeps,
  tracker: UsageTracker,
  options: { idleMs?: number } = {}
): Promise<ReapOutcome[]> {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const now = deps.now()
  const outcomes: ReapOutcome[] = []

  for (const project of await deps.listProjects()) {
    try {
      const running = await deps.runningEphemeral(project.id)
      if (running.length === 0) continue

      const toStop = decideIdleStops(tracker.usageFor(project.id, running), { now, idleMs })
      if (toStop.length === 0) continue

      await deps.stopGroups(project.id, toStop)
      outcomes.push({ projectId: project.id, slug: project.slug, stopped: toStop })
      deps.log(`${project.slug}: stopped idle ${toStop.join(', ')}`)
    } catch (error) {
      deps.log(`${project.slug}: reap failed — ${error instanceof Error ? error.message : error}`)
    }
  }

  return outcomes
}

/**
 * Start the periodic pass. Returns the stop function.
 *
 * The timer is unref'd so it can never hold the process open, and starting twice is prevented by the
 * caller — this function itself stays free of global state so tests can run it directly.
 */
export function startIdleReaper(
  deps: IdleReaperDeps,
  tracker: UsageTracker,
  options: { intervalMs?: number; idleMs?: number; maxPasses?: number } = {}
): () => void {
  const intervalMs = options.intervalMs ?? 5 * 60 * 1000
  let passes = 0

  const timer = setInterval(() => {
    passes += 1
    void reapOnce(deps, tracker, { idleMs: options.idleMs }).catch((error) =>
      deps.log(`idle reaper pass failed: ${error instanceof Error ? error.message : error}`)
    )
    if (options.maxPasses !== undefined && passes >= options.maxPasses) clearInterval(timer)
  }, intervalMs)

  // Never keep the event loop alive just to check whether something could be stopped.
  if (typeof timer.unref === 'function') timer.unref()

  return () => clearInterval(timer)
}
