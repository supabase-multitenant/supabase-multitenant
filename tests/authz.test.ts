import { describe, it, expect } from 'vitest'
import {
  hasRole,
  requireRole,
  can,
  requirePermission,
  ROLE_RANK,
  type Role,
  type Permission,
} from '@/lib/authz'

const ROLES: Role[] = ['owner', 'admin', 'member']

describe('hasRole (hierarchy)', () => {
  it('ranks owner > admin > member', () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin)
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.member)
  })

  it('allows a role to satisfy itself and everything below it', () => {
    expect(hasRole('owner', 'owner')).toBe(true)
    expect(hasRole('owner', 'admin')).toBe(true)
    expect(hasRole('owner', 'member')).toBe(true)

    expect(hasRole('admin', 'owner')).toBe(false)
    expect(hasRole('admin', 'admin')).toBe(true)
    expect(hasRole('admin', 'member')).toBe(true)

    expect(hasRole('member', 'owner')).toBe(false)
    expect(hasRole('member', 'admin')).toBe(false)
    expect(hasRole('member', 'member')).toBe(true)
  })

  it('rejects unknown / missing roles', () => {
    expect(hasRole(null, 'member')).toBe(false)
    expect(hasRole(undefined, 'member')).toBe(false)
    expect(hasRole('superuser', 'member')).toBe(false)
    expect(hasRole('', 'member')).toBe(false)
  })
})

describe('requireRole', () => {
  it('throws a 403-shaped error when insufficient', () => {
    try {
      requireRole('member', 'owner')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { status?: number }).status).toBe(403)
    }
  })

  it('does not throw when sufficient', () => {
    expect(() => requireRole('owner', 'admin')).not.toThrow()
  })
})

describe('permission matrix', () => {
  // role x permission — the canonical RBAC matrix
  const expected: Record<Permission, Record<Role, boolean>> = {
    'project:read': { owner: true, admin: true, member: true },
    'project:create': { owner: true, admin: true, member: false },
    'project:update': { owner: true, admin: true, member: false },
    'project:delete': { owner: true, admin: false, member: false },
    'project:deploy': { owner: true, admin: true, member: false },
    'settings:write': { owner: true, admin: false, member: false },
    'member:invite': { owner: true, admin: true, member: false },
    'member:role': { owner: true, admin: false, member: false },
    'member:remove': { owner: true, admin: false, member: false },
    'billing:read': { owner: true, admin: true, member: false },
    'admin:overview': { owner: true, admin: true, member: false },
  }

  for (const [permission, byRole] of Object.entries(expected) as [Permission, Record<Role, boolean>][]) {
    for (const role of ROLES) {
      it(`${role} ${byRole[role] ? 'can' : 'cannot'} ${permission}`, () => {
        expect(can(role, permission)).toBe(byRole[role])
      })
    }
  }

  it('requirePermission throws 403 for a denied permission', () => {
    try {
      requirePermission('member', 'project:delete')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { status?: number }).status).toBe(403)
    }
  })
})
