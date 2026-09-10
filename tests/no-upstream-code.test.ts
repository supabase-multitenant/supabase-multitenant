import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * A guard rail, not a formality.
 *
 * We hold a commercial licence for MakerKit's Supabase Turbo kit and use it as a
 * *reference* only — its EULA forbids distributing its code, and this project is
 * open source. The rule is "take the behaviour, write our own expression".
 *
 * That rule is easy to state and easy to break by accident: a future session, an
 * over-eager paste, a "just this one helper". This test makes the boundary
 * mechanical. If any of these identifiers appear in our code, something was
 * copied rather than re-expressed, and the build fails.
 *
 * See docs/reference/makerkit-notes.md for the full protocol.
 */

const ROOT = process.cwd()

/** Our own code. Prose docs are excluded — naming a product isn't copying it. */
const SCAN_DIRS = ['src', 'prisma', 'tests']
const SCAN_FILES = ['package.json', 'next.config.js', 'tailwind.config.js', 'tsconfig.json']

/**
 * Identifiers that are only present if MakerKit source was taken.
 *
 * Deliberately specific: generic words like "role", "organization" or
 * "permission" are ours too and must not be flagged.
 */
const FINGERPRINTS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /makerkit/i, why: 'MakerKit naming' },
  { pattern: /next-supabase-saas-kit/i, why: 'upstream repository name' },
  { pattern: /@kit\//, why: 'their internal package scope (e.g. @kit/shared)' },
  { pattern: /keystatic/i, why: "their CMS dependency, which we don't use" },
  { pattern: /app_permissions/i, why: 'their permission enum name' },
  { pattern: /role_permissions/i, why: 'their role/permission table name' },
  { pattern: /hierarchy_level/i, why: 'their role table column name' },
]

/** This file necessarily contains the patterns it searches for. */
const SELF = 'no-upstream-code'

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs|json|prisma|css|sql)$/.test(entry)) out.push(full)
  }
  return out
}

function candidateFiles(): string[] {
  const files = [
    ...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))),
    ...SCAN_FILES.map((f) => join(ROOT, f)),
  ]
  return files.filter((f) => !f.includes(SELF))
}

describe('no upstream boilerplate code', () => {
  it('finds files to scan (the guard is actually running)', () => {
    const files = candidateFiles()
    expect(files.length).toBeGreaterThan(50)
  })

  it('contains no MakerKit identifiers in our code', () => {
    const offences: string[] = []

    for (const file of candidateFiles()) {
      const rel = relative(ROOT, file).split(sep).join('/')
      let content: string
      try {
        content = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      for (const { pattern, why } of FINGERPRINTS) {
        if (pattern.test(content)) offences.push(`${rel}: matched ${pattern} (${why})`)
      }
    }

    expect(offences, `Copied upstream identifiers found:\n${offences.join('\n')}`).toEqual([])
  })

  it('lists no MakerKit packages as dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    const deps = Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    })
    const upstream = deps.filter((d) => d.startsWith('@kit/') || /makerkit/i.test(d))
    expect(upstream).toEqual([])
  })

  it('is not a turbo monorepo — their layout was not taken', () => {
    // Their kit ships as apps/packages/tooling with a turbo.json at the root.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.workspaces).toBeUndefined()
  })
})
