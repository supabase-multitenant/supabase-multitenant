import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_IDLE_MS,
  EPHEMERAL_GROUPS,
  UsageTracker,
  decideIdleStops,
  reapOnce,
  startIdleReaper,
  type IdleReaperDeps,
} from '@/lib/idle-reaper'

const MIN = 60 * 1000
const NOW = 1_700_000_000_000

describe('which groups may be stopped', () => {
  it('stops a human-facing group once it has been idle long enough', () => {
    expect(
      decideIdleStops([{ group: 'dashboard', lastUsedAt: NOW - 31 * MIN }], { now: NOW })
    ).toEqual(['dashboard'])
  })

  it('leaves it alone while it is still in use', () => {
    expect(decideIdleStops([{ group: 'dashboard', lastUsedAt: NOW - 5 * MIN }], { now: NOW })).toEqual([])
  })

  it('stops exactly at the boundary', () => {
    expect(decideIdleStops([{ group: 'dashboard', lastUsedAt: NOW - DEFAULT_IDLE_MS }], { now: NOW })).toEqual(
      ['dashboard']
    )
  })

  it('NEVER stops core, however idle it looks', () => {
    // Stopping core means stopping the database. There is no idle long enough to justify that.
    const usage = ['db', 'auth', 'rest'].map((group) => ({ group, lastUsedAt: NOW - 999 * MIN }))
    expect(decideIdleStops(usage, { now: NOW })).toEqual([])
  })

  it('NEVER stops a group the user deliberately enabled', () => {
    // The whole point. `realtime` runs because somebody wants it. An API does not stop being called
    // because nobody opened the dashboard, so stopping a wanted service to save memory would break
    // a customer's application.
    const usage = ['realtime', 'storage', 'imgproxy', 'functions'].map((group) => ({
      group,
      lastUsedAt: NOW - 999 * MIN,
    }))
    expect(decideIdleStops(usage, { now: NOW })).toEqual([])
  })

  it('is not accidentally widened by adding a group name', () => {
    expect([...EPHEMERAL_GROUPS]).toEqual(['dashboard'])
  })

  it('returns only the eligible group when idle and ineligible groups are mixed in', () => {
    const usage = [
      { group: 'db', lastUsedAt: NOW - 999 * MIN },
      { group: 'realtime', lastUsedAt: NOW - 999 * MIN },
      { group: 'dashboard', lastUsedAt: NOW - 999 * MIN },
    ]
    expect(decideIdleStops(usage, { now: NOW })).toEqual(['dashboard'])
  })

  it('honours a custom window', () => {
    expect(decideIdleStops([{ group: 'dashboard', lastUsedAt: NOW - 6 * MIN }], { now: NOW, idleMs: 5 * MIN })).toEqual(
      ['dashboard']
    )
  })
})

describe('the usage tracker', () => {
  it('records and reads back a use', () => {
    const tracker = new UsageTracker(() => NOW)
    tracker.record('p1', 'dashboard')
    expect(tracker.lastUsedAt('p1', 'dashboard')).toBe(NOW)
  })

  it('reports nothing for a group that was never used', () => {
    // Unknown must be distinguishable from idle, because the reaper treats them differently.
    expect(new UsageTracker(() => NOW).lastUsedAt('p1', 'dashboard')).toBeNull()
  })

  it('keeps projects apart', () => {
    const tracker = new UsageTracker(() => NOW)
    tracker.record('p1', 'dashboard', NOW - 100 * MIN)
    expect(tracker.usageFor('p2', ['dashboard'])).toEqual([])
  })

  it('only reports groups it actually knows about', () => {
    const tracker = new UsageTracker(() => NOW)
    tracker.record('p1', 'dashboard', NOW)
    expect(tracker.usageFor('p1', ['dashboard', 'realtime'])).toEqual([
      { group: 'dashboard', lastUsedAt: NOW },
    ])
  })

  it('forgets one project without touching another', () => {
    const tracker = new UsageTracker(() => NOW)
    tracker.record('p1', 'dashboard', NOW)
    tracker.record('p2', 'dashboard', NOW)
    tracker.forget('p1')
    expect(tracker.lastUsedAt('p1', 'dashboard')).toBeNull()
    expect(tracker.lastUsedAt('p2', 'dashboard')).toBe(NOW)
  })
})

function deps(overrides: Partial<IdleReaperDeps> = {}): IdleReaperDeps {
  return {
    now: () => NOW,
    listProjects: async () => [{ id: 'p1', slug: 'project101' }],
    runningEphemeral: async () => ['dashboard'],
    stopGroups: async () => {},
    log: () => {},
    ...overrides,
  }
}

describe('a reaping pass', () => {
  it('stops an idle group', async () => {
    const tracker = new UsageTracker(() => NOW)
    tracker.record('p1', 'dashboard', NOW - 60 * MIN)
    const stopGroups = vi.fn(async () => {})
    const out = await reapOnce(deps({ stopGroups }), tracker)
    expect(out).toEqual([{ projectId: 'p1', slug: 'project101', stopped: ['dashboard'] }])
    expect(stopGroups).toHaveBeenCalledWith('p1', ['dashboard'])
  })

  it('does nothing when the group is in use', async () => {
    const tracker = new UsageTracker(() => NOW)
    tracker.record('p1', 'dashboard', NOW - MIN)
    const stopGroups = vi.fn(async () => {})
    expect(await reapOnce(deps({ stopGroups }), tracker)).toEqual([])
    expect(stopGroups).not.toHaveBeenCalled()
  })

  it('treats an unknown timestamp as in-use rather than idle', async () => {
    // The conservative direction: a missed stop costs a few hundred megabytes, a wrong stop costs a
    // user a cold start while they are working.
    const stopGroups = vi.fn(async () => {})
    expect(await reapOnce(deps({ stopGroups }), new UsageTracker(() => NOW))).toEqual([])
    expect(stopGroups).not.toHaveBeenCalled()
  })

  it('skips a project with nothing ephemeral running, without needing a timestamp', async () => {
    const stopGroups = vi.fn(async () => {})
    const out = await reapOnce(deps({ runningEphemeral: async () => [], stopGroups }), new UsageTracker(() => NOW))
    expect(out).toEqual([])
    expect(stopGroups).not.toHaveBeenCalled()
  })

  it('keeps going when one project fails', async () => {
    // A project with a broken compose must not prevent reaping the others.
    const tracker = new UsageTracker(() => NOW)
    tracker.record('broken', 'dashboard', NOW - 60 * MIN)
    tracker.record('fine', 'dashboard', NOW - 60 * MIN)
    const stopGroups = vi.fn(async (id: string) => {
      if (id === 'broken') throw new Error('compose file missing')
    })
    const logged: string[] = []
    const out = await reapOnce(
      deps({
        listProjects: async () => [
          { id: 'broken', slug: 'all0e' },
          { id: 'fine', slug: 'project101' },
        ],
        stopGroups,
        log: (m) => logged.push(m),
      }),
      tracker
    )
    expect(out.map((o) => o.slug)).toEqual(['project101'])
    expect(logged.some((l) => l.includes('all0e') && l.includes('failed'))).toBe(true)
  })

  it('reaps several projects in one pass', async () => {
    const tracker = new UsageTracker(() => NOW)
    tracker.record('p1', 'dashboard', NOW - 60 * MIN)
    tracker.record('p2', 'dashboard', NOW - 90 * MIN)
    const stopGroups = vi.fn(async () => {})
    const out = await reapOnce(
      deps({
        listProjects: async () => [
          { id: 'p1', slug: 'a' },
          { id: 'p2', slug: 'b' },
        ],
        stopGroups,
      }),
      tracker
    )
    expect(out).toHaveLength(2)
    expect(stopGroups).toHaveBeenCalledTimes(2)
  })
})

describe('the periodic pass', () => {
  it('stops passing once told to stop', async () => {
    vi.useFakeTimers()
    try {
      const stopGroups = vi.fn(async () => {})
      const tracker = new UsageTracker(() => NOW)
      tracker.record('p1', 'dashboard', NOW - 60 * MIN)
      const stop = startIdleReaper(deps({ stopGroups }), tracker, { intervalMs: 1000 })

      await vi.advanceTimersByTimeAsync(1000)
      expect(stopGroups).toHaveBeenCalledTimes(1)

      stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(stopGroups).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not hold the process open', () => {
    // A timer that keeps the event loop alive would be a leak in every runtime that loads this.
    const tracker = new UsageTracker(() => NOW)
    const stop = startIdleReaper(deps(), tracker, { intervalMs: 60_000 })
    stop()
  })
})
