/**
 * Role-based access control.
 *
 * Roles are hierarchical and org-scoped:  owner > admin > member.
 * See the permission matrix in docs/adr/0001-authjs.md (extended in M2).
 */
export type Role = 'owner' | 'admin' | 'member'

export const ROLE_RANK: Record<Role, number> = {
  owner: 3,
  admin: 2,
  member: 1,
}

export function isRole(value: string | null | undefined): value is Role {
  return value === 'owner' || value === 'admin' || value === 'member'
}

export function hasRole(userRole: string | null | undefined, required: Role): boolean {
  if (!isRole(userRole)) return false
  return ROLE_RANK[userRole] >= ROLE_RANK[required]
}

/** Throws a 403-shaped error object when the role is insufficient. */
export function requireRole(userRole: string | null | undefined, required: Role): void {
  if (!hasRole(userRole, required)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }
}

/** Permission matrix: which role each action requires. */
export const PERMISSIONS = {
  'project:read': 'member',
  'project:create': 'admin',
  'project:update': 'admin',
  'project:delete': 'owner',
  'project:deploy': 'admin',
  'settings:write': 'owner',
  'member:invite': 'admin',
  'member:role': 'owner',
  'member:remove': 'owner',
  'billing:read': 'admin',
  'admin:overview': 'admin',
} as const

export type Permission = keyof typeof PERMISSIONS

export function can(userRole: string | null | undefined, permission: Permission): boolean {
  return hasRole(userRole, PERMISSIONS[permission])
}

export function requirePermission(userRole: string | null | undefined, permission: Permission): void {
  if (!can(userRole, permission)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }
}
