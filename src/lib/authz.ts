/**
 * Authorization: roles, permissions, and how they combine.
 *
 * Single source of truth. Access is expressed as **permissions** (concrete rules
 * like `project:deploy`), never as role comparisons in call sites — that is what
 * makes custom, admin-defined roles possible: a role is just a named bundle of
 * permissions.
 *
 * Access levels, weakest to strongest:
 *   viewer    – reporting only: see things, change nothing
 *   developer – day-to-day work: env vars, deploys, backups, SQL
 *   admin     – run the organization: projects, members, custom roles
 *   owner     – everything, including deleting the organization
 *
 * `member` is accepted as an alias of `developer` so existing rows keep working.
 */

// ---------------------------------------------------------------------------
// Permission catalog
// ---------------------------------------------------------------------------

export interface PermissionMeta {
  group: string
  label: string
  /** Dangerous permissions are highlighted when assigning custom roles. */
  sensitive?: boolean
}

export const PERMISSION_CATALOG = {
  // Organization
  'org:read': { group: 'Organization', label: 'View the organization' },
  'org:update': { group: 'Organization', label: 'Edit organization settings' },
  'org:delete': { group: 'Organization', label: 'Delete the organization', sensitive: true },

  // Members and roles
  'member:read': { group: 'Members & roles', label: 'View members' },
  'member:invite': { group: 'Members & roles', label: 'Invite members' },
  'member:update': { group: 'Members & roles', label: "Change a member's role" },
  'member:remove': { group: 'Members & roles', label: 'Remove members' },
  'role:read': { group: 'Members & roles', label: 'View roles' },
  'role:manage': { group: 'Members & roles', label: 'Create and edit custom roles' },

  // Projects
  'project:read': { group: 'Projects', label: 'View projects' },
  'project:create': { group: 'Projects', label: 'Create projects' },
  'project:update': { group: 'Projects', label: 'Edit project settings' },
  'project:delete': { group: 'Projects', label: 'Delete projects', sensitive: true },
  'project:deploy': { group: 'Projects', label: 'Deploy and restart projects' },

  // Data access
  'db:inspect': { group: 'Data', label: 'Open the database in Studio' },
  'db:sql': { group: 'Data', label: 'Run SQL against the database', sensitive: true },

  // Secrets
  'env:read': { group: 'Secrets', label: 'Reveal environment variables and API keys', sensitive: true },
  'env:write': { group: 'Secrets', label: 'Edit environment variables' },

  // Backups
  'backup:read': { group: 'Backups', label: 'View backups' },
  'backup:create': { group: 'Backups', label: 'Create a backup' },
  'backup:restore': { group: 'Backups', label: 'Restore a backup', sensitive: true },
  'backup:delete': { group: 'Backups', label: 'Delete a backup', sensitive: true },

  // Insights
  'analytics:read': { group: 'Insights', label: 'View usage and analytics' },
  'audit:read': { group: 'Insights', label: 'View the audit log' },
  'billing:read': { group: 'Insights', label: 'View billing' },
} as const satisfies Record<string, PermissionMeta>

export type Permission = keyof typeof PERMISSION_CATALOG

export const ALL_PERMISSIONS = Object.keys(PERMISSION_CATALOG) as Permission[]

/** Catalog grouped for rendering a permission picker. */
export function permissionsByGroup(): Array<{ group: string; permissions: Permission[] }> {
  const groups = new Map<string, Permission[]>()
  for (const permission of ALL_PERMISSIONS) {
    const { group } = PERMISSION_CATALOG[permission]
    groups.set(group, [...(groups.get(group) ?? []), permission])
  }
  return [...groups.entries()].map(([group, permissions]) => ({ group, permissions }))
}

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSION_CATALOG, value)
}

/** Every permission in a group (used to define role presets). */
function groupPermissions(group: string): Permission[] {
  return ALL_PERMISSIONS.filter((p) => PERMISSION_CATALOG[p].group === group)
}

// ---------------------------------------------------------------------------
// Built-in roles
// ---------------------------------------------------------------------------

export const BUILT_IN_ROLES = ['viewer', 'developer', 'admin', 'owner'] as const
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number]

/** `member` predates the access-level naming; treat it as `developer`. */
export type Role = BuiltInRole | 'member'

export const ROLE_RANK: Record<BuiltInRole, number> = {
  viewer: 1,
  developer: 2,
  admin: 3,
  owner: 4,
}

/** What each level can do. Ordering of the spreads encodes the escalation. */
const VIEWER_PERMISSIONS: Permission[] = [
  'org:read',
  'member:read',
  'role:read',
  'project:read',
  'db:inspect',
  'backup:read',
  ...groupPermissions('Insights'),
]

const DEVELOPER_PERMISSIONS: Permission[] = [
  ...VIEWER_PERMISSIONS,
  'project:deploy',
  'db:sql',
  'env:read',
  'env:write',
  'backup:create',
  'backup:restore',
]

const ADMIN_PERMISSIONS: Permission[] = [
  ...DEVELOPER_PERMISSIONS,
  'org:update',
  'member:invite',
  'member:update',
  'member:remove',
  'role:manage',
  'project:create',
  'project:update',
  'project:delete',
  'backup:delete',
]

export interface RoleMeta {
  label: string
  description: string
  permissions: Permission[]
}

export const ROLE_DEFINITIONS: Record<BuiltInRole, RoleMeta> = {
  viewer: {
    label: 'Viewer',
    description: 'Read-only: reporting and analytics. Can see projects and inspect data, but change nothing.',
    permissions: VIEWER_PERMISSIONS,
  },
  developer: {
    label: 'Developer',
    description: 'Day-to-day work: deploy, manage secrets, take and restore backups, run SQL.',
    permissions: DEVELOPER_PERMISSIONS,
  },
  admin: {
    label: 'Administrator',
    description: 'Runs the organization: projects, members, and custom roles.',
    permissions: ADMIN_PERMISSIONS,
  },
  owner: {
    label: 'Owner',
    description: 'Full control, including deleting the organization and transferring ownership.',
    permissions: ALL_PERMISSIONS,
  },
}

export const ROLE_LABELS: Record<Role, string> = {
  viewer: 'Viewer',
  developer: 'Developer',
  member: 'Developer',
  admin: 'Administrator',
  owner: 'Owner',
}

/** Roles offered in the UI, strongest first. */
export function assignableRoles(): BuiltInRole[] {
  return ['owner', 'admin', 'developer', 'viewer']
}

export function isBuiltInRole(value: string | null | undefined): value is BuiltInRole {
  return typeof value === 'string' && (BUILT_IN_ROLES as readonly string[]).includes(value)
}

/** Legacy/absent roles resolve to `viewer` — the least privilege, not the most. */
export function normalizeRole(value: string | null | undefined): BuiltInRole {
  if (value === 'member') return 'developer'
  return isBuiltInRole(value) ? value : 'viewer'
}

/** Kept for call sites that check a role directly. */
export function isRole(value: string | null | undefined): value is Role {
  return value === 'member' || isBuiltInRole(value)
}

export function hasRole(userRole: string | null | undefined, required: BuiltInRole): boolean {
  return ROLE_RANK[normalizeRole(userRole)] >= ROLE_RANK[required]
}

export function requireRole(userRole: string | null | undefined, required: BuiltInRole): void {
  if (!hasRole(userRole, required)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }
}

export function permissionsForRole(role: string | null | undefined): Permission[] {
  return [...ROLE_DEFINITIONS[normalizeRole(role)].permissions]
}

// ---------------------------------------------------------------------------
// Custom roles
// ---------------------------------------------------------------------------

export interface PermissionSource {
  /** Built-in level, if the member has no custom role. */
  role?: string | null
  /** Explicit permissions, when the member has a custom role. */
  customPermissions?: string[] | null
}

/**
 * Effective permissions for a member.
 *
 * A custom role **replaces** the built-in set rather than adding to it, so an
 * administrator can express "developer, but without secrets access" — additive
 * bundles could only ever widen access.
 */
export function resolveEffectivePermissions(source: PermissionSource): Permission[] {
  if (source.customPermissions && source.customPermissions.length > 0) {
    return source.customPermissions.filter(isPermission)
  }
  return permissionsForRole(source.role)
}

export function hasPermission(
  permissions: readonly Permission[],
  permission: Permission
): boolean {
  return permissions.includes(permission)
}

/** Accepts either a role name or an explicit permission list. */
export function can(
  subject: string | null | undefined | PermissionSource,
  permission: Permission
): boolean {
  if (typeof subject === 'string' || subject == null) {
    return hasPermission(permissionsForRole(subject), permission)
  }
  return hasPermission(resolveEffectivePermissions(subject), permission)
}

export function requirePermission(
  subject: string | null | undefined | PermissionSource,
  permission: Permission
): void {
  if (!can(subject, permission)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }
}

export interface PermissionValidation {
  valid: Permission[]
  unknown: string[]
  duplicates: string[]
}

/** Sanitize a permission list coming from the API before it is stored. */
export function validatePermissions(input: unknown): PermissionValidation {
  if (!Array.isArray(input)) return { valid: [], unknown: [], duplicates: [] }

  const valid: Permission[] = []
  const unknown: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()

  for (const entry of input) {
    if (typeof entry !== 'string') {
      unknown.push(String(entry))
      continue
    }
    if (!isPermission(entry)) {
      unknown.push(entry)
      continue
    }
    if (seen.has(entry)) {
      duplicates.push(entry)
      continue
    }
    seen.add(entry)
    valid.push(entry)
  }

  return { valid, unknown, duplicates }
}

// ---------------------------------------------------------------------------
// Anti-escalation
// ---------------------------------------------------------------------------

export function isSubsetOf(subset: readonly Permission[], superset: readonly Permission[]): boolean {
  const have = new Set(superset)
  return subset.every((permission) => have.has(permission))
}

/**
 * You may only hand out access you already hold.
 *
 * This single rule covers the whole hierarchy: an admin lacks `org:delete`, so
 * an admin cannot grant `owner`; nobody but an owner holds `org:delete`, so only
 * an owner can create another owner. It also bounds custom roles — an admin
 * cannot define or assign a role that reaches beyond their own permissions.
 */
export function canGrantPermissions(
  actorPermissions: readonly Permission[],
  grantedPermissions: readonly Permission[]
): boolean {
  return isSubsetOf(grantedPermissions, actorPermissions)
}

export interface GrantCheck {
  ok: boolean
  reason?: string
  /** Permissions the actor would be handing out but does not hold. */
  excess?: Permission[]
}

/** Why a grant was refused, for a useful error message. */
export function checkGrant(
  actorPermissions: readonly Permission[],
  grantedPermissions: readonly Permission[]
): GrantCheck {
  const have = new Set(actorPermissions)
  const excess = grantedPermissions.filter((permission) => !have.has(permission))
  if (excess.length === 0) return { ok: true }
  return {
    ok: false,
    reason: 'You cannot grant access you do not have yourself.',
    excess,
  }
}

/** Refuse if granting would exceed the actor's own access. */
export function requireCanGrant(
  actorPermissions: readonly Permission[],
  grantedPermissions: readonly Permission[]
): void {
  const check = checkGrant(actorPermissions, grantedPermissions)
  if (!check.ok) {
    throw Object.assign(new Error(check.reason ?? 'Forbidden'), {
      status: 403,
      excess: check.excess,
    })
  }
}
