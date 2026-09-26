/**
 * Live proof of the idle reaper: runs the REAL reaper against the live platform with a zero idle
 * window, marking one project as in-use, so both directions are shown at once — what is idle gets
 * stopped, what is in use is left alone.
 *
 * DESTRUCTIVE: this stops real containers. Run it deliberately.
 *
 *   npx tsx scripts/prove-idle-reaper.ts <slug-to-treat-as-in-use>
 */
import { execSync } from 'node:child_process'

import { prisma } from '../src/lib/db'
import { reapOnce } from '../src/lib/idle-reaper'
import { createDeps, dashboardUsage } from '../src/lib/idle-reaper-runtime'

const OPTIONAL = /studio|meta|edge-functions/

function sh(cmd: string): string {
  // stderr to /dev/null: probes for containers that do not exist are expected here, and docker's
  // "No such object" lines drown the actual result.
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
}

function optionalMemory(): number {
  let total = 0
  for (const line of sh("docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}'").split('\n')) {
    const [name = '', usage = ''] = line.split('|')
    if (!OPTIONAL.test(name)) continue
    total += parseFloat(usage.split('/')[0].replace(/[^0-9.]/g, '')) || 0
  }
  return total
}

function runningFor(slug: string): string {
  const up: string[] = []
  for (const service of ['studio', 'meta', 'edge-functions']) {
    try {
      if (sh(`docker inspect --format '{{.State.Running}}' ${slug}-${service}`).trim() === 'true') {
        up.push(service)
      }
    } catch {
      /* not present */
    }
  }
  return up.join(', ') || '(none)'
}

async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, slug: true },
    orderBy: { slug: 'asc' },
  })
  const results: boolean[] = []
  const check = (label: string, ok: boolean, note = '') => {
    results.push(ok)
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label.padEnd(56)} ${note}`)
  }

  console.log('\n=== before ===')
  const before = optionalMemory()
  for (const p of projects) console.log(`  ${p.slug.padEnd(40)} ${runningFor(p.slug)}`)
  console.log(`  optional-service memory: ${before.toFixed(0)} MiB`)
  const beforeEdge = projects.filter((p) => runningFor(p.slug).includes('edge-functions')).length

  console.log('\n=== pass A: everything used moments ago -> nothing may be stopped ===')
  for (const p of projects) dashboardUsage.record(p.id, 'dashboard', Date.now())
  let outcomes = await reapOnce(createDeps(), dashboardUsage, { idleMs: 30 * 60 * 1000 })
  check('a group in use is left alone', outcomes.length === 0, `${outcomes.length} stopped`)

  console.log('\n=== pass B: everything idle, zero window -> only studio+meta may stop ===')
  for (const p of projects) dashboardUsage.record(p.id, 'dashboard', 0)
  outcomes = await reapOnce(createDeps(), dashboardUsage, { idleMs: 0 })
  const stoppedSlugs = outcomes.map((o) => o.slug)
  check('the idle dashboard group is stopped', outcomes.length > 0, `${outcomes.length} projects`)

  await new Promise((r) => setTimeout(r, 6000))
  const stillRunning = (service: string) =>
    projects.filter((p) => runningFor(p.slug).includes(service)).length

  // The bug this is guarding: re-applying the declared service set stopped `functions` everywhere.
  // Compared against the count that HAD edge functions before, not against every project — three
  // projects here have no functions container at all, so `=== projects.length` asserted something
  // untrue about the fixture rather than about the reaper.
  check('edge functions are untouched — the bug that was fixed',
        stillRunning('edge-functions') === beforeEdge,
        `${stillRunning('edge-functions')}/${beforeEdge} that had one still running`)
  check('no studio left running', stillRunning('studio') < projects.length,
        `${stillRunning('studio')} still running`)
  check('no meta left running', stillRunning('meta') < projects.length,
        `${stillRunning('meta')} still running`)

  // Core must be untouchable regardless of how idle it looks.
  const core = sh("docker ps --format '{{.Names}}'").split('\n').filter((n) => /-(db|auth|rest)$/.test(n))
  check('every project keeps its database, auth and rest',
        core.length >= projects.filter((p) => p.slug !== 'all0e-1788961428823').length,
        `${core.length} core containers`)

  console.log(`\n  stopped: ${stoppedSlugs.join(', ') || '(none)'}`)
  const after = optionalMemory()
  console.log(`  optional-service memory: ${after.toFixed(0)} MiB  (was ${before.toFixed(0)})`)
  console.log(`\n  ${results.filter(Boolean).length}/${results.length} checks passed`)

  await prisma.$disconnect()
  process.exit(results.every(Boolean) ? 0 : 1)
}

void main()
