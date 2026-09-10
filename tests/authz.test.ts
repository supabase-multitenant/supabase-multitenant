import { describe, it, expect } from 'vitest'

import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLES,
  PERMISSION_CATALOG,
  ROLE_DEFINITIONS,
  ROLE_RANK,
  can,
  canGrantPermissions,
  checkGrant,
  isSubsetOf,
  requireCanGrant,
  hasPermission,
  hasRole,
  isBuiltInRole,
  isPermission,
  normalizeRole,
  permissionsByGroup,
  permissionsForRole,
  requirePermission,
  requireRole,
  resolveEffectivePermissions,
  validatePermissions,
  type BuiltInRole,
  type Permission,
} from '@/lib/authz'

// ---------------------------------------------------------------------------
// Catalog integrity
// ---------------------------------------------------------------------------

describe('permission catalog', () => {
  it('every permission has a group and a label', () => {
    for (const permission of ALL_PERMISSIONS) {
      const meta = PERMISSION_CATALOG[permission]
      expect(meta.group, `${permission} group`).toBeTruthy()
      expect(meta.label, `${permission} label`).toBeTruthy()
    }
  })

  it('every permission belongs to exactly one group when grouped', () => {
    const grouped = permissionsByGroup().flatMap((g) => g.permissions)
    expect(grouped.sort()).toEqual([...ALL_PERMISSIONS].sort())
  })

  it('recognises valid and rejects invalid permission strings', () => {
    expect(isPermission('project:read')).toBe(true)
    expect(isPermission('project:launch')).toBe(false)
    expect(isPermission('')).toBe(false)
  })

  it('does not inherit Object.prototype keys as permissions', () => {
    // `in` vs hasOwnProperty: a naive lookup would accept these.
    expect(isPermission('toString')).toBe(false)
    expect(isPermission('constructor')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The RBAC matrix: role x capability
// ---------------------------------------------------------------------------

describe('role capability matrix', () => {
  const matrix: Record<BuiltInRole, { can: Permission[]; cannot: Permission[] }> = {
    viewer: {
      can: ['org:read', 'project:read', 'db:inspect', 'backup:read', 'analytics:read', 'audit:read', 'member:read', 'role:read', 'billing:read'],
      cannot: [
        'project:create', 'project:update', 'project:delete', 'project:deploy',
        'env:read', 'env:write', 'db:sql', 'backup:create', 'backup:restore', 'backup:delete',
        'member:invite', 'member:update', 'member:remove', 'role:manage',
        'org:update', 'org:delete',
      ],
    },
    developer: {
      can: [
        // everything a viewer can do
        'org:read', 'member:read', 'role:read', 'project:read', 'db:inspect',
        'backup:read', 'analytics:read', 'audit:read', 'billing:read',
        // plus day-to-day work
        'project:deploy', 'env:read', 'env:write', 'db:sql', 'backup:create', 'backup:restore',
      ],
      cannot: [
        'org:update', 'org:delete',
        'member:invite', 'member:update', 'member:remove', 'role:manage',
        'project:create', 'project:update', 'project:delete', 'backup:delete',
      ],
    },
    admin: {
      can: ALL_PERMISSIONS.filter((p) => p !== 'org:delete'),
      cannot: ['org:delete'],
    },
    owner: {
      can: [...ALL_PERMISSIONS],
      cannot: [],
    },
  }

  for (const role of BUILT_IN_ROLES) {
    for (const permission of matrix[role].can) {
      it(`${role} CAN ${permission}`, () => {
        expect(can(role, permission)).toBe(true)
      })
    }
    for (const permission of matrix[role].cannot) {
      it(`${role} CANNOT ${permission}`, () => {
        expect(can(role, permission)).toBe(false)
      })
    }
  }

  it('covers every permission for every role (no gaps in the matrix above)', () => {
    for (const role of BUILT_IN_ROLES) {
      const covered = new Set([...matrix[role].can, ...matrix[role].cannot])
      expect(covered.size, `${role} coverage`).toBe(ALL_PERMISSIONS.length)
    }
  })
})

// ---------------------------------------------------------------------------
// Escalation invariants — the properties that keep privilege escalation out
// ---------------------------------------------------------------------------

describe('role escalation invariants', () => {
  it('ranks the levels in order', () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.developer)
    expect(ROLE_RANK.developer).toBeLessThan(ROLE_RANK.admin)
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.owner)
  })

  it('each level is a superset of the one below it', () => {
    const viewer = new Set(permissionsForRole('viewer'))
    const developer = new Set(permissionsForRole('developer'))
    const admin = new Set(permissionsForRole('admin'))
    const owner = new Set(permissionsForRole('owner'))

    for (const p of viewer) expect(developer.has(p), `developer missing ${p}`).toBe(true)
    for (const p of developer) expect(admin.has(p), `admin missing ${p}`).toBe(true)
    for (const p of admin) expect(owner.has(p), `owner missing ${p}`).toBe(true)
  })

  it('owner holds every permission that exists', () => {
    const owner = new Set(permissionsForRole('owner'))
    for (const permission of ALL_PERMISSIONS) {
      expect(owner.has(permission), `owner missing ${permission}`).toBe(true)
    }
  })

  it('only owner can delete the organization', () => {
    for (const role of ['viewer', 'developer', 'admin'] as BuiltInRole[]) {
      expect(can(role, 'org:delete')).toBe(false)
    }
    expect(can('owner', 'org:delete')).toBe(true)
  })

  it('viewer cannot do anything mutating', () => {
    const mutating = ALL_PERMISSIONS.filter((p) =>
      /:(create|update|delete|write|deploy|restore|manage|invite|remove)$/.test(p)
    )
    expect(mutating.length).toBeGreaterThan(5)
    for (const permission of mutating) {
      expect(can('viewer', permission), `viewer should not ${permission}`).toBe(false)
    }
  })

  it('developers cannot widen their own access', () => {
    // Neither inviting, nor changing roles, nor editing custom roles.
    expect(can('developer', 'member:invite')).toBe(false)
    expect(can('developer', 'member:update')).toBe(false)
    expect(can('developer', 'role:manage')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Legacy + unknown roles
// ---------------------------------------------------------------------------

describe('role normalisation', () => {
  it('treats the legacy "member" as developer', () => {
    expect(normalizeRole('member')).toBe('developer')
    expect(can('member', 'project:deploy')).toBe(true)
    expect(can('member', 'project:create')).toBe(false)
  })

  it('falls back to the LEAST privilege for unknown/absent roles', () => {
    for (const bad of [null, undefined, '', 'superuser', 'ADMIN', 'root']) {
      expect(normalizeRole(bad), `${String(bad)}`).toBe('viewer')
      expect(can(bad, 'project:create')).toBe(false)
      expect(can(bad, 'env:read')).toBe(false)
      // ...but reading is still allowed, so a mis-set role is not a lockout
      expect(can(bad, 'project:read')).toBe(true)
    }
  })

  it('is case-sensitive — "ADMIN" must not be read as admin', () => {
    expect(can('ADMIN', 'org:delete')).toBe(false)
    expect(can('Admin', 'member:invite')).toBe(false)
  })

  it('isBuiltInRole / hasRole behave', () => {
    expect(isBuiltInRole('admin')).toBe(true)
    expect(isBuiltInRole('member')).toBe(false) // legacy alias, not built-in
    expect(hasRole('owner', 'admin')).toBe(true)
    expect(hasRole('admin', 'owner')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Custom roles
// ---------------------------------------------------------------------------

describe('custom roles', () => {
  it('replace the built-in set rather than adding to it', () => {
    // "developer, but without secrets" — narrowing must work.
    const narrowed = resolveEffectivePermissions({
      role: 'developer',
      customPermissions: ['project:read', 'project:deploy', 'db:inspect'],
    })
    expect(hasPermission(narrowed, 'project:deploy')).toBe(true)
    expect(hasPermission(narrowed, 'env:read')).toBe(false)
    expect(hasPermission(narrowed, 'env:write')).toBe(false)
  })

  it('can also GRANT beyond the member role, but only what is listed', () => {
    const custom = resolveEffectivePermissions({
      role: 'viewer',
      customPermissions: ['project:read', 'backup:create'],
    })
    expect(hasPermission(custom, 'backup:create')).toBe(true)
    expect(hasPermission(custom, 'backup:restore')).toBe(false)
    expect(hasPermission(custom, 'org:delete')).toBe(false)
  })

  it('silently drops permissions that no longer exist in the catalog', () => {
    const custom = resolveEffectivePermissions({
      role: 'viewer',
      customPermissions: ['project:read', 'legacy:thing', 'toString'],
    })
    expect(custom).toEqual(['project:read'])
    expect(hasPermission(custom, 'project:read')).toBe(true)
  })

  it('falls back to the built-in role when the custom list is empty', () => {
    expect(resolveEffectivePermissions({ role: 'admin', customPermissions: [] })).toEqual(
      permissionsForRole('admin')
    )
    expect(resolveEffectivePermissions({ role: 'admin', customPermissions: null })).toEqual(
      permissionsForRole('admin')
    )
  })

  it('can() accepts a permission source directly', () => {
    const source = { role: 'developer', customPermissions: ['project:read'] as string[] }
    expect(can(source, 'project:read')).toBe(true)
    expect(can(source, 'project:deploy')).toBe(false)
  })
})

describe('validatePermissions', () => {
  it('separates valid, unknown and duplicate entries', () => {
    const result = validatePermissions([
      'project:read',
      'project:read',
      'nope:whatever',
      'backup:create',
      42,
    ])
    expect(result.valid).toEqual(['project:read', 'backup:create'])
    expect(result.unknown).toEqual(['nope:whatever', '42'])
    expect(result.duplicates).toEqual(['project:read'])
  })

  it('handles non-array input without throwing', () => {
    for (const bad of [null, undefined, 'project:read', 7, {}]) {
      expect(validatePermissions(bad)).toEqual({ valid: [], unknown: [], duplicates: [] })
    }
  })
})

// ---------------------------------------------------------------------------
// Throwing helpers
// ---------------------------------------------------------------------------

describe('require helpers', () => {
  it('throw a 403-shaped error when the permission is missing', () => {
    try {
      requirePermission('viewer', 'project:delete')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { status?: number }).status).toBe(403)
    }
  })

  it('do not throw when allowed', () => {
    expect(() => requirePermission('owner', 'org:delete')).not.toThrow()
    expect(() => requireRole('admin', 'developer')).not.toThrow()
  })

  it('reject an unknown role rather than defaulting to allow', () => {
    expect(() => requirePermission('superuser', 'project:delete')).toThrow()
    expect(() => requireRole('superuser', 'viewer')).not.toThrow() // viewer is the floor
  })
})

describe('role definitions exposed to the UI', () => {
  it('describe every built-in role with a label, description and permissions', () => {
    for (const role of BUILT_IN_ROLES) {
      const meta = ROLE_DEFINITIONS[role]
      expect(meta.label).toBeTruthy()
      expect(meta.description.length).toBeGreaterThan(10)
      expect(meta.permissions.length).toBeGreaterThan(0)
    }
  })

  it('viewer is the smallest set and owner the largest', () => {
    const sizes = BUILT_IN_ROLES.map((r) => ROLE_DEFINITIONS[r].permissions.length)
    expect(sizes[0]).toBeLessThan(sizes[1])
    expect(sizes[1]).toBeLessThan(sizes[2])
    expect(sizes[2]).toBeLessThan(sizes[3])
  })
})

// ---------------------------------------------------------------------------
// Anti-escalation: you cannot hand out access you do not hold
// ---------------------------------------------------------------------------

describe('grant checks', () => {
  const perms = (role: string) => permissionsForRole(role)

  it('lets a role grant its own permissions', () => {
    expect(canGrantPermissions(perms('admin'), perms('admin'))).toBe(true)
  })

  it('lets a stronger role grant a weaker one', () => {
    expect(canGrantPermissions(perms('owner'), perms('admin'))).toBe(true)
    expect(canGrantPermissions(perms('admin'), perms('developer'))).toBe(true)
    expect(canGrantPermissions(perms('admin'), perms('viewer'))).toBe(true)
  })

  it('stops a weaker role from granting a stronger one', () => {
    expect(canGrantPermissions(perms('admin'), perms('owner'))).toBe(false)
    expect(canGrantPermissions(perms('developer'), perms('admin'))).toBe(false)
    expect(canGrantPermissions(perms('viewer'), perms('developer'))).toBe(false)
  })

  it('keeps owner-only: only an owner holds org:delete, so only an owner can mint an owner', () => {
    const excess = perms('owner').filter((p) => !perms('admin').includes(p))
    expect(excess).toEqual(['org:delete'])
    expect(canGrantPermissions(perms('admin'), perms('owner'))).toBe(false)
  })

  it('bounds a custom role by what the actor holds', () => {
    const admin = perms('admin')
    // an admin may carve out a narrower custom role
    expect(canGrantPermissions(admin, ['project:read', 'project:deploy', 'db:inspect'])).toBe(true)
    // but not one that reaches past them
    expect(canGrantPermissions(admin, ['project:read', 'org:delete'])).toBe(false)
  })

  it('explains which permissions were overreached', () => {
    const check = checkGrant(perms('viewer'), ['project:read', 'project:delete', 'org:delete'])
    expect(check.ok).toBe(false)
    expect(check.excess).toEqual(['project:delete', 'org:delete'])
    expect(check.reason).toMatch(/cannot grant access you do not have/i)
  })

  it('requireCanGrant throws 403 with the excess list', () => {
    try {
      requireCanGrant(perms('developer'), perms('admin'))
      throw new Error('should have thrown')
    } catch (e) {
      const err = e as { status?: number; excess?: string[] }
      expect(err.status).toBe(403)
      expect(err.excess?.length).toBeGreaterThan(0)
    }
  })

  it('isSubsetOf handles the empty set and duplicates', () => {
    expect(isSubsetOf([], perms('viewer'))).toBe(true)
    expect(isSubsetOf(['project:read'], perms('viewer'))).toBe(true)
    expect(isSubsetOf(['project:read', 'project:read'], perms('viewer'))).toBe(true)
    expect(isSubsetOf(['org:delete'], perms('viewer'))).toBe(false)
  })
})
