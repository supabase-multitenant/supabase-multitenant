import { describe, expect, it } from 'vitest'

import {
  APP_ROLE,
  InvalidUserRefError,
  isValidUserRef,
  planRequestScope,
} from '@/lib/rls'

const UUID = '09175f10-71c4-4661-a0ba-a2d43c771c54'

describe('the scoping plan', () => {
  it('assumes the restricted role and declares the user', () => {
    const plan = planRequestScope(UUID)
    expect(plan.statements[0]).toBe(`set local role ${APP_ROLE}`)
    expect(plan.statements[1]).toContain("set_config('app.user_id'")
    expect(plan.parameter).toBe(UUID)
  })

  it('binds the user as a parameter rather than writing it into the SQL', () => {
    // A session setting takes a string, which makes it exactly the kind of value that becomes an
    // injection vector when concatenated. The literal must not appear in the statement text.
    const plan = planRequestScope(UUID)
    for (const statement of plan.statements) {
      expect(statement).not.toContain(UUID)
    }
    expect(plan.statements[1]).toContain('$1')
  })

  it('scopes the change to the transaction', () => {
    // Pooled connections are reused; a non-local setting would leak the previous request's identity
    // into the next one — the worst possible failure here.
    expect(planRequestScope(UUID).statements[1]).toContain(', true)')
  })

  it('uses `set local role` so the role also reverts with the transaction', () => {
    expect(planRequestScope(UUID).statements[0].startsWith('set local role')).toBe(true)
  })
})

describe('refusing bad user references', () => {
  it('accepts a well-formed UUID', () => {
    expect(isValidUserRef(UUID)).toBe(true)
    expect(isValidUserRef(UUID.toUpperCase())).toBe(true)
  })

  it('refuses anything that is not a UUID', () => {
    // Failing to NO identity is safe; failing to a WRONG identity is not.
    for (const bad of [
      '',
      'not-a-uuid',
      null,
      undefined,
      123,
      {},
      `${UUID}' or '1'='1`,
      `${UUID} `,
      '09175f10-71c4-4661-a0ba-a2d43c771c5',
      "'; drop table projects; --",
    ]) {
      expect(isValidUserRef(bad)).toBe(false)
      expect(() => planRequestScope(bad)).toThrow(InvalidUserRefError)
    }
  })

  it('does not silently accept a SQL-injection shaped value', () => {
    expect(() => planRequestScope(`${UUID}'; set local role postgres; --`)).toThrow(InvalidUserRefError)
  })
})
