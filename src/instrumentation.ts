/**
 * Started once when the server boots (Next.js instrumentation hook).
 *
 * The idle reaper lives here rather than in a scheduler outside the app: what it stops are this
 * app's own service groups, so it belongs to the app's lifetime. A panel that is not running has no
 * services to reap, and there is no second moving part to secure, monitor or discover later.
 */
export async function register(): Promise<void> {
  // The instrumentation hook also runs for the edge runtime, where there is no database client and
  // no docker socket. The reaper only makes sense in the node server.
  //
  // Written as `if (process.env.NEXT_RUNTIME === 'nodejs') { ... }` and not as an early return: the
  // value is inlined per compilation, and only this shape lets the bundler drop the branch — and
  // with it the import — from the edge bundle. With an early return the import survives into the
  // edge compilation, which then fails on the node-only modules it pulls in.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startOnce } = await import('./lib/idle-reaper-runtime')
      startOnce()
    } catch (error) {
      // Never let optional housekeeping prevent the server from starting: a panel that boots without
      // the reaper is degraded, a panel that does not boot is down.
      console.error(
        `[instrumentation] idle reaper did not start: ${error instanceof Error ? error.message : error}`
      )
    }
  }
}
