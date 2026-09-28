import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mergeEnvFile } from '@/lib/env-file'

/**
 * The contract that matters here is negative: a function that edits a project's `.env` must be
 * incapable of removing anything it was not asked to remove. The panel already has a writer that
 * rebuilds the file from the variables it is given, and using it for one setting would delete the
 * project's database password.
 */
describe('mergeEnvFile', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-file-'))
    file = path.join(dir, '.env')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const read = () => fs.readFile(file, 'utf8')

  it('preserves every variable it was not asked to change', async () => {
    await fs.writeFile(
      file,
      ['POSTGRES_PASSWORD=db-secret', 'JWT_SECRET=jwt-secret', 'OPENAI_API_KEY='].join('\n')
    )

    await mergeEnvFile(file, { OPENAI_API_KEY: 'token-123' })

    const result = await read()
    expect(result).toContain('POSTGRES_PASSWORD=db-secret')
    expect(result).toContain('JWT_SECRET=jwt-secret')
    expect(result).toContain('OPENAI_API_KEY=token-123')
  })

  it('replaces a value in place instead of appending a second entry', async () => {
    await fs.writeFile(file, 'KEEP=1\nOPENAI_API_KEY=old\nALSO_KEEP=2')

    await mergeEnvFile(file, { OPENAI_API_KEY: 'new' })

    const result = await read()
    expect(result.match(/OPENAI_API_KEY=/g)).toHaveLength(1)
    expect(result).toContain('OPENAI_API_KEY=new')
    expect(result).toContain('KEEP=1')
    expect(result).toContain('ALSO_KEEP=2')
  })

  it('removes a line when told null — an empty base URL would still be read as a URL', async () => {
    await fs.writeFile(file, 'KEEP=1\nOPENAI_BASE_URL=https://relay.example.com/v1\n')

    await mergeEnvFile(file, { OPENAI_BASE_URL: null })

    const result = await read()
    expect(result).not.toContain('OPENAI_BASE_URL')
    expect(result).toContain('KEEP=1')
  })

  it('adds a variable that is not there yet', async () => {
    await fs.writeFile(file, 'KEEP=1\n')

    await mergeEnvFile(file, { OPENAI_BASE_URL: 'https://panel.example.com/api/ai/p/v1' })

    expect(await read()).toContain('OPENAI_BASE_URL=https://panel.example.com/api/ai/p/v1')
  })

  it('creates the file when it does not exist', async () => {
    await mergeEnvFile(file, { OPENAI_API_KEY: 'token' })

    expect(await read()).toContain('OPENAI_API_KEY=token')
  })

  it('sets an empty value distinctly from removing the key', async () => {
    await fs.writeFile(file, 'OPENAI_API_KEY=token\n')

    await mergeEnvFile(file, { OPENAI_API_KEY: '' })

    const result = await read()
    expect(result).toContain('OPENAI_API_KEY=')
    expect(result).not.toContain('OPENAI_API_KEY=token')
  })

  it('does not turn one trailing newline into a growing blank tail', async () => {
    await fs.writeFile(file, 'A=1\n')

    await mergeEnvFile(file, { A: '2' })
    await mergeEnvFile(file, { A: '3' })

    const result = await read()
    expect(result).toBe('A=3\n')
  })

  it('leaves comments and blank lines alone', async () => {
    await fs.writeFile(file, ['# a comment', '', 'A=1'].join('\n'))

    await mergeEnvFile(file, { B: '2' })

    const result = await read()
    expect(result).toContain('# a comment')
    expect(result).toContain('A=1')
    expect(result).toContain('B=2')
  })
})
