/**
 * Slim project composes (ADR-0003, phases 2 and 4).
 *
 * A project created from the upstream template gets **11 services**. Five of them are infrastructure
 * we now run once for everybody, and three are data-plane services a project may never use:
 *
 *   shared, never per project : api-gw, supavisor, studio, meta, imgproxy
 *   always per project        : db, auth, rest
 *   per project when used     : realtime, storage, functions
 *
 * This module turns the 11-service template into the 3–6 service stack a project actually needs.
 *
 * It is a text transformation over the generated compose, not a rewrite from scratch, because the
 * template is the thing Supabase maintains: we drop and rewire what we do not want and leave
 * everything else byte-identical.
 *
 * ## Why the removed service lists are explicit
 *
 * `storage` needs `imgproxy`, and `studio` needs `meta`, so removing a shared service can break a
 * kept one. The reference graph is asserted in tests rather than assumed: a service may only be
 * dropped when nothing that survives still points at it, and the one legitimate cross-boundary
 * reference (`storage` -> the shared imgproxy) is rewritten to the shared DNS name.
 */

export const SHARED_PLANE_SERVICES = ['api-gw', 'studio', 'imgproxy', 'meta', 'supavisor'] as const

/** Every project needs these; without any one of them there is no usable Supabase. */
export const PER_PROJECT_REQUIRED = ['db', 'auth', 'rest'] as const

/** Heavy, single-purpose services. Included only when the project asks for them. */
export const PER_PROJECT_OPTIONAL = ['realtime', 'storage', 'functions'] as const

export type OptionalService = (typeof PER_PROJECT_OPTIONAL)[number]

/**
 * Service -> the services it references. Used to refuse a removal that would strand a survivor.
 *
 * `storage` -> `imgproxy` is the single reference that crosses the shared boundary; it is rewritten
 * rather than treated as a blocker. `functions`/`studio` -> `api-gw` is handled by the internal-host
 * rewrite. Everything else is intra-project.
 */
export const SERVICE_DEPENDENCIES: Record<string, string[]> = {
  'db': [],
  'auth': ['db'],
  'rest': ['db'],
  'realtime': ['db'],
  'storage': ['db', 'imgproxy'],
  'functions': ['db', 'auth'],
  'imgproxy': [],
  'meta': ['db'],
  'studio': ['meta', 'db'],
  'api-gw': ['auth', 'rest', 'realtime', 'storage', 'functions', 'meta', 'studio'],
  'supavisor': ['db'],
}

export class SlimComposeError extends Error {
  constructor(
    message: string,
    readonly detail: string[] = []
  ) {
    super(message)
    this.name = 'SlimComposeError'
  }
}

export interface SlimComposeOptions {
  slug: string
  /** Optional services to keep. Required services are always kept. */
  optional?: OptionalService[]
  /**
   * The tenant's port on the shared gateway. Internal callers are pointed at
   * `http://<slug>-gw:<gatewayPort>`.
   */
  gatewayPort: number
  /** DNS name of the shared imgproxy, for `storage` when imgproxy is not per project. */
  sharedImgproxyHost?: string
}

export interface SlimComposeResult {
  compose: string
  kept: string[]
  removed: string[]
  /** References rewritten across the shared boundary, for the audit trail. */
  rewires: string[]
}

/**
 * Which compose services a project should end up with.
 */
export function servicesForProject(optional: OptionalService[] = []): string[] {
  const unknown = optional.filter((s) => !PER_PROJECT_OPTIONAL.includes(s))
  if (unknown.length > 0) {
    throw new SlimComposeError(`Unknown optional service(s): ${unknown.join(', ')}`)
  }
  return [...PER_PROJECT_REQUIRED, ...optional]
}

/**
 * Split a compose file's `services:` section into its service blocks, preserving everything else.
 *
 * The trailer after the services section (`volumes:`, `networks:`) is captured separately and must
 * be preserved — dropping it produces a stack that cannot start, which is the exact defect the
 * shared-plane splitter had to be fixed for.
 */
interface ComposeParts {
  before: string[]
  services: Array<{ name: string; lines: string[] }>
  after: string[]
  serviceIndent: number
}

export function parseCompose(compose: string): ComposeParts {
  const lines = compose.split('\n')
  const serviceStart = lines.findIndex((l) => /^services:\s*$/.test(l))
  if (serviceStart === -1) {
    throw new SlimComposeError('Compose file has no top-level `services:` section')
  }

  let serviceEnd = lines.length
  for (let i = serviceStart + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && !/^[ \t]/.test(lines[i])) {
      serviceEnd = i
      break
    }
  }

  const services: Array<{ name: string; lines: string[] }> = []
  let current: { name: string; lines: string[] } | null = null
  let serviceIndent = -1

  for (let i = serviceStart + 1; i < serviceEnd; i++) {
    const match = /^(\s+)([A-Za-z0-9._-]+):\s*$/.exec(lines[i])
    if (match && (serviceIndent === -1 || match[1].length === serviceIndent)) {
      if (serviceIndent === -1) serviceIndent = match[1].length
      current = { name: match[2], lines: [] }
      services.push(current)
      continue
    }
    if (current) current.lines.push(lines[i])
  }

  if (services.length === 0) {
    throw new SlimComposeError('Compose `services:` section contains no services')
  }
  if (serviceIndent === -1) {
    throw new SlimComposeError('Could not determine the service key indentation')
  }

  return {
    before: lines.slice(0, serviceStart + 1),
    services,
    after: lines.slice(serviceEnd),
    serviceIndent,
  }
}

/**
 * Remove a nested list entry (a `depends_on:` child) and, if that empties the parent key, the
 * parent too.
 *
 * `depends_on:` with nothing under it is invalid and Compose rejects the whole file with
 * `services.X.depends_on must be a array` — which is how this was found the first time.
 */
export function dropDependencyEntries(lines: string[], names: Set<string>): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const m = /^(\s+)([A-Za-z0-9._-]+):\s*$/.exec(lines[i])
    if (m && names.has(m[2])) {
      const indent = m[1].length
      let j = i + 1
      while (
        j < lines.length &&
        (lines[j].trim() === '' || lines[j].length - lines[j].trimStart().length > indent)
      ) {
        j++
      }
      i = j
      continue
    }
    out.push(lines[i])
    i++
  }

  // second pass: drop `depends_on:` keys left with no children
  const cleaned: string[] = []
  i = 0
  while (i < out.length) {
    const m = /^(\s+)depends_on:\s*$/.exec(out[i])
    if (m) {
      const indent = m[1].length
      let j = i + 1
      while (
        j < out.length &&
        (out[j].trim() === '' || out[j].length - out[j].trimStart().length > indent)
      ) {
        j++
      }
      if (j === i + 1) {
        i = j
        continue
      }
    }
    cleaned.push(out[i])
    i++
  }
  return cleaned
}

/**
 * Turn an 11-service template compose into the slim stack a project needs.
 */
export function slimProjectCompose(
  compose: string,
  options: SlimComposeOptions
): SlimComposeResult {
  const { slug, gatewayPort } = options
  const optional = options.optional ?? []
  const keep = new Set(servicesForProject(optional))

  const parts = parseCompose(compose)
  const present = new Set(parts.services.map((s) => s.name))

  const removed = parts.services.map((s) => s.name).filter((n) => !keep.has(n))

  // Refuse a removal that strands a survivor.
  const stranded: string[] = []
  for (const service of removed) {
    const dependents = [...keep].filter((k) => (SERVICE_DEPENDENCIES[k] ?? []).includes(service))
    for (const dependent of dependents) {
      const excused =
        (dependent === 'storage' && service === 'imgproxy' && options.sharedImgproxyHost) ||
        (dependent === 'functions' && service === 'api-gw')
      if (!excused) stranded.push(`${dependent} -> ${service}`)
    }
  }
  if (stranded.length > 0) {
    throw new SlimComposeError(
      `Removing these services would strand a kept service: ${stranded.join(', ')}. ` +
        `Either keep the service or provide its shared replacement.`,
      stranded
    )
  }

  const rewires: string[] = []

  const keptServices = parts.services
    .filter((s) => keep.has(s.name))
    .map((s) => {
      const lines = dropDependencyEntries(s.lines, new Set(removed))

      const joined = lines.join('\n')
      let next = joined

      // internal API calls -> the tenant's listener on the shared gateway
      const apiUrl = `http://${slug}-gw:${gatewayPort}`
      if (next.includes('http://api-gw:8000')) {
        next = next.split('http://api-gw:8000').join(apiUrl)
        rewires.push(`http://api-gw:8000 -> ${apiUrl}`)
      }

      // storage -> shared imgproxy
      if (options.sharedImgproxyHost && next.includes('imgproxy:8080')) {
        next = next.split('imgproxy:8080').join(`${options.sharedImgproxyHost}:8080`)
        rewires.push(`imgproxy:8080 -> ${options.sharedImgproxyHost}:8080`)
      }

      return { name: s.name, lines: next.split('\n') }
    })

  const indent = ' '.repeat(parts.serviceIndent)
  const body = keptServices
    .map((s) => [`${indent}${s.name}:`, ...s.lines].join('\n').replace(/\n+$/, ''))
    .join('\n\n')

  const out = [...parts.before, body, ...parts.after].join('\n')

  if (removed.some((r) => new RegExp(`^\\s+${r}:\\s*$`, 'm').test(out))) {
    throw new SlimComposeError('Refusing to emit a compose that still contains a removed service')
  }
  for (const kept of keep) {
    if (present.has(kept) && !new RegExp(`^\\s+${kept}:\\s*$`, 'm').test(out)) {
      throw new SlimComposeError(`Refusing to emit a compose that lost kept service ${kept}`)
    }
  }
  if (!/\nvolumes:\s*$/m.test(out) && /\nvolumes:\s*$/m.test(compose)) {
    throw new SlimComposeError('Refusing to emit a compose that dropped the volumes trailer')
  }

  return { compose: out, kept: [...keep].sort(), removed: removed.sort(), rewires }
}
