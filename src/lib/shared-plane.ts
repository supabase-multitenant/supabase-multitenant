/**
 * The shared infrastructure plane (ADR-0003).
 *
 * Supabase Multitenant exists to reproduce the Supabase Cloud model: the platform is stood up
 * **once** and each new project adds only a database plus the services that are physically bound
 * to it. The inherited fork design instead copied the entire self-hosted stack per project —
 * including the gateway and the dashboard, which are precisely what the product promises to run
 * once.
 *
 * This module owns that split. It is pure (no filesystem access) so the invariant below is
 * testable, which is the point: if a future service or an upstream rebase quietly reintroduces a
 * shared-plane service into a project stack, the suite fails instead of the waste returning.
 *
 * ## Which side of the line a service falls on
 *
 * A service belongs to the **shared plane** when it holds no tenant database of its own:
 *
 * - `api-gw` (envoy)   — pure router, no tenant state
 * - `supavisor`        — binds `/_supabase`, its OWN metadata DB, so one pooler multiplexes every
 *                        tenant database (this is what makes a shared pooler possible at all)
 * - `imgproxy`         — stateless, no database
 * - `studio`           — holds no DB of its own; reaches tenants via `STUDIO_PG_META_URL` +
 *                        `api-gw`, so one instance can serve every project
 * - `meta`             — addresses a database per request; shared once multi-DB routing lands
 *
 * A service stays **per project** when it is configured with exactly one connection string and has
 * no tenant selector, so it cannot multiplex across separate Postgres instances:
 *
 * - `db`        — the tenant's data; the only part that must multiply
 * - `auth`      — `GOTRUE_DB_DATABASE_URL`
 * - `rest`      — `PGRST_DB_URI`
 * - `realtime`  — bound to the tenant database's WAL / replication slots
 * - `storage`   — `DATABASE_URL` (its schema lives in the tenant database)
 * - `functions` — `SUPABASE_DB_URL`
 *
 * That second list is a physical constraint, not a shortcut. Supabase Cloud carries the same
 * constraint and also runs those services per project. Sharing them would require one Postgres
 * with per-tenant schemas, which was explicitly rejected: it trades away per-tenant database
 * isolation, which is the product.
 */

/** Services that belong to the shared plane and must never appear in a project stack. */
export const SHARED_PLANE_SERVICES = ['studio', 'api-gw', 'imgproxy', 'meta', 'supavisor'] as const

/** Services that stay per project because each binds exactly one tenant database. */
export const PER_PROJECT_SERVICES = [
  'db',
  'auth',
  'rest',
  'realtime',
  'storage',
  'functions',
] as const

/** Compose project name for the shared plane. */
export const SHARED_PLANE_NAME = 'supabase-multitenant-shared'

/** A single entry from a compose `services:` map, kept verbatim. */
export interface ServiceBlock {
  name: string
  /** The block's original lines, including its `  name:` header. */
  lines: string[]
}

/** Raised when a compose document cannot be split safely. */
export class ComposeSplitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComposeSplitError'
  }
}

/**
 * Split a compose document into its `services:` blocks, verbatim.
 *
 * Line-based on purpose: rewriting a generated compose through a YAML round-trip would reorder
 * keys, strip comments and change quoting, and this file is both generated and human-diffed.
 * The parser only needs to find service boundaries, which are unambiguous in the Supabase
 * template (`services:` at column 0, service names at a single consistent inner indent).
 */
export function parseServiceBlocks(composeContent: string): ServiceBlock[] {
  const lines = composeContent.split('\n')
  const blocks: ServiceBlock[] = []

  const servicesHeader = lines.findIndex((line) => /^services:\s*$/.test(line))
  if (servicesHeader === -1) {
    throw new ComposeSplitError('Compose document has no top-level `services:` key')
  }

  let serviceIndent: string | null = null
  let current: ServiceBlock | null = null
  let pendingComments: string[] = []

  for (let i = servicesHeader + 1; i < lines.length; i++) {
    const line = lines[i]

    // Any non-indented, non-empty line closes the services section.
    if (line.trim() !== '' && !/^\s/.test(line)) break

    const header = line.match(/^(\s+)([A-Za-z0-9._-]+):[ \t]*$/)

    // A comment at service indent belongs to whichever service follows it.
    if (/^\s*#/.test(line) && serviceIndent !== null && line.match(/^\s*/)?.[0] === serviceIndent) {
      pendingComments.push(line)
      continue
    }

    if (header && (serviceIndent === null || header[1] === serviceIndent)) {
      serviceIndent ??= header[1]
      if (current) blocks.push(current)
      current = { name: header[2], lines: [...pendingComments, line] }
      pendingComments = []
      continue
    }

    if (current) current.lines.push(line)
    else pendingComments = [] // indented content before the first service: not ours
  }

  if (current) blocks.push(current)

  if (blocks.length === 0) {
    throw new ComposeSplitError('Compose document has a `services:` key but no services')
  }

  // Trailing blank lines separate blocks, they do not belong to them. Keeping them would make
  // re-rendering unstable, and the split non-idempotent.
  return blocks.map((block) => ({ ...block, lines: trimTrailingBlankLines(block.lines) }))
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length
  while (end > 1 && lines[end - 1].trim() === '') end -= 1
  return lines.slice(0, end)
}

/** A compose document taken apart for reassembly: preamble, service blocks, and trailer. */
export interface ComposeDocument {
  /** Everything up to and including the `services:` line. */
  header: string
  blocks: ServiceBlock[]
  /** Top-level keys after the services section (`volumes:`, `networks:`, …), verbatim. */
  trailer: string
}

/**
 * Decompose a compose document into header, service blocks and trailer.
 *
 * The trailer has to be preserved rather than dropped: in the Supabase template the volumes it
 * declares (`db-config`, `deno-cache`) belong to *per-project* services, so a project stack
 * without it cannot start.
 */
export function splitComposeDocument(composeContent: string): ComposeDocument {
  const lines = composeContent.split('\n')
  const servicesHeader = lines.findIndex((line) => /^services:\s*$/.test(line))
  if (servicesHeader === -1) {
    throw new ComposeSplitError('Compose document has no top-level `services:` key')
  }

  let trailerStart = lines.length
  for (let i = servicesHeader + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() !== '' && !/^\s/.test(line)) {
      trailerStart = i
      break
    }
  }

  return {
    header: lines.slice(0, servicesHeader + 1).join('\n'),
    blocks: parseServiceBlocks(composeContent),
    trailer: lines.slice(trailerStart).join('\n'),
  }
}

/** Names of every service in the document, in file order. */
export function listServiceNames(composeContent: string): string[] {
  return parseServiceBlocks(composeContent).map((block) => block.name)
}

/**
 * The invariant: shared-plane services present in a project stack.
 *
 * Empty is the only acceptable result for a generated project compose. A non-empty result means
 * infrastructure is being duplicated per project again — the exact waste this product exists to
 * remove — and must fail the calling code rather than be tolerated.
 */
export function findSharedPlaneServices(composeContent: string): string[] {
  const shared = new Set<string>(SHARED_PLANE_SERVICES)
  return listServiceNames(composeContent).filter((name) => shared.has(name))
}

/** Raised when a project stack still contains shared-plane services. */
export class SharedPlaneLeakError extends Error {
  readonly offenders: string[]

  constructor(slug: string, offenders: string[]) {
    super(
      `Refusing to generate a project stack for "${slug}": these services belong to the shared ` +
        `infrastructure plane and would duplicate it per project: ${offenders.join(', ')}. ` +
        `See ADR-0003 and splitProjectCompose().`
    )
    this.name = 'SharedPlaneLeakError'
    this.offenders = offenders
  }
}

/** Result of splitting one generated stack into its project part and its shared part. */
export interface SplitComposeResult {
  /** The per-project compose: only services bound to this tenant's database. */
  projectCompose: string
  /** The service blocks that belong to the shared plane, verbatim. */
  sharedServices: ServiceBlock[]
  /** Names of the services that were lifted out. */
  hoisted: string[]
}

function renderBlocks(blocks: ServiceBlock[]): string {
  return blocks.map((block) => block.lines.join('\n')).join('\n\n')
}

/**
 * Split a generated stack into a per-project compose and the shared-plane blocks.
 *
 * Pure and idempotent. Throws {@link SharedPlaneLeakError} if the project side would still carry
 * a shared service, so a template change that reintroduces one fails loudly at generation time.
 */
export function splitProjectCompose(composeContent: string, slug: string): SplitComposeResult {
  const shared = new Set<string>(SHARED_PLANE_SERVICES)
  const { header, blocks, trailer } = splitComposeDocument(composeContent)
  const sharedServices = blocks.filter((block) => shared.has(block.name))
  const projectServices = blocks.filter((block) => !shared.has(block.name))

  if (projectServices.length === 0) {
    throw new ComposeSplitError(
      `Splitting "${slug}" left no per-project services — refusing to emit an empty stack`
    )
  }

  const parts = [header, renderBlocks(projectServices)]
  if (trailer.trim() !== '') parts.push(trailer.replace(/^\n+/, '').replace(/\n+$/, ''))

  let projectCompose = parts.join('\n\n')
  if (!projectCompose.endsWith('\n')) projectCompose += '\n'

  const offenders = findSharedPlaneServices(projectCompose)
  if (offenders.length > 0) {
    throw new SharedPlaneLeakError(slug, offenders)
  }

  return {
    projectCompose,
    sharedServices,
    hoisted: sharedServices.map((block) => block.name),
  }
}

/**
 * Build the shared-plane compose from hoisted service blocks.
 *
 * The blocks come from the *same* generated template the projects use, so the shared plane runs
 * exactly the images and configuration the projects used to duplicate. Container names are left
 * as the template wrote them (`supabase-studio`, `supabase-envoy`, …) because there is now
 * exactly one of each and the `supabase-` prefix is what the upstream configs expect.
 */
export function buildSharedPlaneCompose(
  sharedServices: ServiceBlock[],
  options: { volumes?: string[]; networks?: string[] } = {}
): string {
  if (sharedServices.length === 0) {
    throw new ComposeSplitError('Cannot build a shared plane with no services')
  }

  const sections: string[] = [
    `name: ${SHARED_PLANE_NAME}`,
    '',
    'services:',
    renderBlocks(sharedServices),
    '',
  ]

  if (options.networks?.length) {
    sections.push('networks:')
    sections.push(...options.networks.map((network) => `  ${network}:`))
    sections.push('')
  }

  if (options.volumes?.length) {
    sections.push('volumes:')
    sections.push(...options.volumes.map((volume) => `  ${volume}:`))
    sections.push('')
  }

  return sections.join('\n')
}
