import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

// Build the forbidden needles dynamically so this test file never contains
// them as literals (otherwise the scan would flag its own source).
const OLD_BRAND = ['supa', 'panel'].join('')
const HYPHEN_DISPLAY = ['Supabase-', 'Multitenant'].join('')

const ROOT = process.cwd()

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.pi', '.vercel', 'coverage', 'tests'])
const BINARY_EXTENSIONS = new Set(['.png', '.ico', '.jpg', '.jpeg', '.gif', '.webp'])
const SKIP_FILES = new Set(['package-lock.json'])

function isTextFile(file: string): boolean {
  const ext = path.extname(file).toLowerCase()
  if (BINARY_EXTENSIONS.has(ext)) return false
  if (SKIP_FILES.has(path.basename(file))) return false
  return true
}

function walk(dir: string): string[] {
  const result: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      result.push(...walk(full))
    } else if (isTextFile(full)) {
      result.push(full)
    }
  }
  return result
}

function scan(forbidden: string, caseInsensitive = false): string[] {
  const offenders: string[] = []
  for (const file of walk(ROOT)) {
    const content = fs.readFileSync(file, 'utf8')
    const haystack = caseInsensitive ? content.toLowerCase() : content
    const needle = caseInsensitive ? forbidden.toLowerCase() : forbidden
    if (haystack.includes(needle)) offenders.push(file)
  }
  return offenders
}

describe('rebrand completeness', () => {
  it('has no leftover old brand (supapanel) anywhere in source/config/docs', () => {
    expect(scan(OLD_BRAND, true)).toEqual([])
  })

  it('uses the space-separated product name, not the hyphenated display variant', () => {
    expect(scan(HYPHEN_DISPLAY)).toEqual([])
  })
})

describe('install script identifier consistency', () => {
  const installScript = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8')

  it('uses the canonical container, network and image names', () => {
    expect(installScript).toContain('container_name: supabase-multitenant-traefik')
    expect(installScript).toContain('container_name: supabase-multitenant-postgres')
    expect(installScript).toContain('container_name: supabase-multitenant-panel')
    expect(installScript).toContain('supabase-multitenant-network')
    expect(installScript).toContain('image: webboxes/supabase-multitenant:')
  })

  it('uses the underscore identifier for the Postgres user/database', () => {
    expect(installScript).toContain('POSTGRES_USER: supabase_multitenant')
    expect(installScript).toContain('POSTGRES_DB: supabase_multitenant')
    expect(installScript).toContain('pg_isready -U supabase_multitenant')
    expect(installScript).toContain('postgresql://supabase_multitenant:')
  })
})
