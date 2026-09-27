import { describe, expect, it } from 'vitest'

import {
  NotSystemAdminError,
  ORGANIZATION_ROLES,
  SYSTEM_ADMIN_ROLE,
  SYSTEM_ADMIN_ROLES,
  assertSystemAdmin,
  isSystemAdmin,
} from '@/lib/system-admin'

describe('who is a system administrator', () => {
  it('is the platform owner and the operator role, and nothing narrower', () => {
    for (const role of SYSTEM_ADMIN_ROLES) {
      expect(isSystemAdmin(role)).toBe(true)
    }
    expect(isSystemAdmin('owner')).toBe(true)
    expect(isSystemAdmin('admin')).toBe(true)
  })

  it('tolerates case and surrounding space, because the value is set by hand', () => {
    expect(isSystemAdmin('Admin')).toBe(true)
    expect(isSystemAdmin('ADMIN')).toBe(true)
    expect(isSystemAdmin('  admin  ')).toBe(true)
    expect(isSystemAdmin('Owner')).toBe(true)
    expect(isSystemAdmin('  OWNER  ')).toBe(true)
  })

  it('is NOT granted by an organization role that is not also a system role', () => {
    // The naming collision that matters: `admin` and `owner` are legitimate *organization* roles
    // too. Those live in `organization_members.role` — a different column in a different table —
    // and the same spelling is why the caller must pass `users.role` and nothing else. The roles
    // below exist only as organization roles and must never read as system authority.
    for (const role of ORGANIZATION_ROLES) {
      if ((SYSTEM_ADMIN_ROLES as readonly string[]).includes(role)) continue
      expect(isSystemAdmin(role)).toBe(false)
    }
    expect(isSystemAdmin('viewer')).toBe(false)
    expect(isSystemAdmin('developer')).toBe(false)
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
      assertSystemAdmin('member')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(NotSystemAdminError)
      expect((error as NotSystemAdminError).status).toBe(403)
      // The message must name what was actually seen, otherwise every refusal looks identical in
      // the logs and a misconfiguration is invisible.
      expect((error as Error).message).toContain('member')
    }
  })

  it('names the absent case distinctly', () => {
    expect(() => assertSystemAdmin(null)).toThrow(/no role/)
  })
})
