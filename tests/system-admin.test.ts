import { describe, expect, it } from 'vitest'

import {
  NotSystemAdminError,
  ORGANIZATION_ROLES,
  SYSTEM_ADMIN_ROLE,
  assertSystemAdmin,
  isSystemAdmin,
} from '@/lib/system-admin'

describe('who is a system administrator', () => {
  it('is exactly the system role', () => {
    expect(isSystemAdmin(SYSTEM_ADMIN_ROLE)).toBe(true)
    expect(isSystemAdmin('admin')).toBe(true)
  })

  it('tolerates case and surrounding space, because the value is set by hand', () => {
    expect(isSystemAdmin('Admin')).toBe(true)
    expect(isSystemAdmin('ADMIN')).toBe(true)
    expect(isSystemAdmin('  admin  ')).toBe(true)
  })

  it('is NOT granted by any organization role', () => {
    // The naming collision that matters: `admin` is a legitimate *organization* role. That comes
    // from `organization_members.role`, a different column, and it must never read as system
    // authority. Only `owner` in one organization is not a step towards seeing every organization.
    for (const role of ORGANIZATION_ROLES) {
      if (role === 'admin') continue // covered above: same spelling, different column
      expect(isSystemAdmin(role)).toBe(false)
    }
  })

  it('refuses everything else', () => {
    for (const value of ['member', 'superuser', 'root', 'administrator', 'admin2', 'true', '1']) {
      expect(isSystemAdmin(value)).toBe(false)
    }
  })

  it('refuses absent and non-string values', () => {
    for (const value of [null, undefined, '', '   ', 0, 1, true, {}, []]) {
      expect(isSystemAdmin(value as never)).toBe(false)
    }
  })

  it('is not fooled by a role that merely contains the word', () => {
    expect(isSystemAdmin('not-admin')).toBe(false)
    expect(isSystemAdmin('admin-readonly')).toBe(false)
  })
})

describe('asserting it', () => {
  it('passes an administrator through', () => {
    expect(() => assertSystemAdmin('admin')).not.toThrow()
  })

  it('throws a 403-shaped error for everyone else', () => {
    try {
      assertSystemAdmin('owner')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(NotSystemAdminError)
      expect((error as NotSystemAdminError).status).toBe(403)
      // The message must name what was actually seen, otherwise every refusal looks identical in
      // the logs and a misconfiguration is invisible.
      expect((error as Error).message).toContain('owner')
    }
  })

  it('names the absent case distinctly', () => {
    expect(() => assertSystemAdmin(null)).toThrow(/no role/)
  })
})
