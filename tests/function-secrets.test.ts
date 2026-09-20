import { describe, expect, it } from 'vitest'

import {
  InvalidFunctionSecretError,
  serializeEnvFile,
  validateFunctionSecrets,
} from '@/lib/function-secrets'

describe('validateFunctionSecrets', () => {
  it('accepts ordinary key/value secrets', () => {
    expect(() =>
      validateFunctionSecrets({ MY_KEY: 'hello', API_TOKEN: 'abc-123', _X: '' })
    ).not.toThrow()
  })

  it('rejects a key starting with a digit', () => {
    expect(() => validateFunctionSecrets({ '1KEY': 'x' })).toThrow(InvalidFunctionSecretError)
  })

  it('rejects a key with illegal characters', () => {
    expect(() => validateFunctionSecrets({ 'MY-KEY': 'x' })).toThrow(InvalidFunctionSecretError)
    expect(() => validateFunctionSecrets({ 'MY KEY': 'x' })).toThrow(InvalidFunctionSecretError)
  })

  it('rejects a value containing a line break (would inject an extra var)', () => {
    expect(() => validateFunctionSecrets({ MY_KEY: 'a\nEVIL=1' })).toThrow(InvalidFunctionSecretError)
    expect(() => validateFunctionSecrets({ MY_KEY: 'a\rb' })).toThrow(InvalidFunctionSecretError)
  })

  it('rejects keys reserved by the edge runtime', () => {
    expect(() => validateFunctionSecrets({ JWT_SECRET: 'x' })).toThrow(InvalidFunctionSecretError)
    expect(() => validateFunctionSecrets({ VERIFY_JWT: 'x' })).toThrow(InvalidFunctionSecretError)
    expect(() => validateFunctionSecrets({ SUPABASE_URL: 'x' })).toThrow(InvalidFunctionSecretError)
    expect(() => validateFunctionSecrets({ SUPABASE_ANYTHING: 'x' })).toThrow(
      InvalidFunctionSecretError
    )
  })
})

describe('serializeEnvFile', () => {
  it('writes KEY=value lines with a trailing newline', () => {
    expect(serializeEnvFile({ A: '1', B: 'two' })).toBe('A=1\nB=two\n')
  })

  it('returns an empty string for no secrets', () => {
    expect(serializeEnvFile({})).toBe('')
  })
})
