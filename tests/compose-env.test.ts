import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it } from 'vitest'

import { composeEnv, envKeysFromText, envWithoutKeys, projectEnvKeys } from '../src/lib/compose-env'

describe('reading the keys a project defines', () => {
  it('takes KEY= lines and ignores blanks and comments', () => {
    const text = [
      '# a comment',
      '',
      'POSTGRES_PASSWORD=abc',
      'JWT_SECRET=def',
      '  SPACED_KEY=ghi  ',
      'not-a-key-line',
      'EMPTY_TAIL=',
    ].join('\n')
    expect(envKeysFromText(text)).toEqual([
      'POSTGRES_PASSWORD',
      'JWT_SECRET',
      'SPACED_KEY',
      'EMPTY_TAIL',
    ])
  })

  it('reads a real file, and treats a missing one as no keys', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'compose-env-'))
    await fs.writeFile(path.join(dir, '.env'), 'A=1\n# c\nB=2\n')
    expect(await projectEnvKeys(dir)).toEqual(['A', 'B'])
    expect(await projectEnvKeys(path.join(dir, 'nowhere'))).toEqual([])
  })
})

describe('the child environment for a project compose run', () => {
  it('removes exactly what the project defines, so its .env wins', () => {
    // The live failure: the panel exported POSTGRES_PASSWORD and every tenant booted with it.
    const panel = { POSTGRES_PASSWORD: 'panel-value', DATABASE_URL: 'panel-db', PATH: '/usr/bin', HOME: '/root' }
    const child = envWithoutKeys(panel, ['POSTGRES_PASSWORD', 'DATABASE_URL'])

    expect(child.POSTGRES_PASSWORD).toBeUndefined()
    expect(child.DATABASE_URL).toBeUndefined()
    expect(child.PATH).toBe('/usr/bin')
    expect(child.HOME).toBe('/root')
  })

  it('does not mutate the environment it was handed', () => {
    // A mutation here would strip the panel's own environment for the rest of the process.
    const panel = { POSTGRES_PASSWORD: 'panel-value' }
    envWithoutKeys(panel, ['POSTGRES_PASSWORD'])
    expect(panel.POSTGRES_PASSWORD).toBe('panel-value')
  })

  it('keeps the panel env when the project defines nothing', () => {
    const panel = { POSTGRES_PASSWORD: 'panel-value' }
    expect(envWithoutKeys(panel, [])).toEqual({ POSTGRES_PASSWORD: 'panel-value' })
  })

  it('never invents a value for a removed key', () => {
    const child = envWithoutKeys({ JWT_SECRET: 'panel' }, ['JWT_SECRET'])
    expect('JWT_SECRET' in child).toBe(false)
    expect(child.JWT_SECRET).toBeUndefined()
  })
})

describe('composeEnv', () => {
  it('is the panel env with the project keys taken out', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'compose-env-'))
    await fs.writeFile(path.join(dir, '.env'), 'HERMES_TEST_LEAK=from-project\n')
    process.env.HERMES_TEST_LEAK = 'from-panel'

    const env = await composeEnv(dir)
    expect(env.HERMES_TEST_LEAK).toBeUndefined()
    expect(env.PATH).toBe(process.env.PATH)
    delete process.env.HERMES_TEST_LEAK
  })
})
