/**
 * Compose namespacing for Supabase Multitenant projects.
 *
 * Every container in a generated project stack must carry the project slug in its
 * `container_name`, otherwise two projects collide on the same global Docker name
 * and one silently takes over (or fails to start) the other's service.
 *
 * This used to be a hardcoded list of `supabase-<service>` -> `<slug>-<service>`
 * mappings. When the API gateway was switched from Kong to Envoy the compose
 * gained `container_name: supabase-envoy`, which was not on the list, so it kept
 * its global name while every sibling was prefixed (issue #104).
 *
 * The mapping is now generic, and — more importantly — guarded: if any
 * `container_name` is left un-namespaced, generation fails loudly instead of
 * producing a stack that quietly breaks multitenancy.
 */

/** The one container that does not use the `supabase-` prefix convention. */
const REALTIME_CONTAINER_NAME = 'realtime-dev.supabase-realtime'

/** Raised when a generated compose still contains a globally-named container. */
export class UnnamespacedContainerError extends Error {
  readonly offenders: string[]

  constructor(slug: string, offenders: string[]) {
    super(
      `Refusing to generate a stack for project "${slug}": these container names ` +
        `would be shared with other projects: ${offenders.join(', ')}. ` +
        `Add a mapping in namespaceContainerNames() or rename them in the compose template.`
    )
    this.name = 'UnnamespacedContainerError'
    this.offenders = offenders
  }
}

/** All `container_name:` values in a compose document, in file order. */
export function listContainerNames(composeContent: string): string[] {
  return [...composeContent.matchAll(/^[ \t]*container_name:[ \t]*(\S+)[ \t]*$/gm)].map(
    (match) => match[1]
  )
}

/** Is this container name scoped to the given project slug? */
export function isNamespacedContainerName(containerName: string, slug: string): boolean {
  return (
    containerName.startsWith(`${slug}-`) ||
    containerName.startsWith(`realtime-dev.${slug}-`)
  )
}

/** Container names in the document that are not scoped to the slug. */
export function findUnnamespacedContainerNames(
  composeContent: string,
  slug: string
): string[] {
  return listContainerNames(composeContent).filter(
    (name) => !isNamespacedContainerName(name, slug)
  )
}

/**
 * Rewrite every `container_name` so it is unique to the project.
 *
 * Pure: no filesystem access, safe to call repeatedly (idempotent).
 * Throws {@link UnnamespacedContainerError} if anything is left global.
 */
export function namespaceContainerNames(composeContent: string, slug: string): string {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Invalid project slug for compose namespacing: ${JSON.stringify(slug)}`)
  }

  let output = composeContent

  // 1. The exception: realtime keeps a `realtime-dev.` tenant prefix, so it needs
  //    an explicit mapping rather than the generic rule below.
  output = output.replaceAll(
    `container_name: ${REALTIME_CONTAINER_NAME}`,
    `container_name: realtime-dev.${slug}-realtime`
  )

  // 2. Everything else: `supabase-anything` -> `<slug>-anything`. A generic rule
  //    means a newly added service is namespaced automatically instead of being
  //    silently forgotten (which is exactly how #104 happened).
  output = output.replace(
    /^([ \t]*container_name:[ \t]*)supabase-([A-Za-z0-9._-]+)[ \t]*$/gm,
    (_match, prefix: string, suffix: string) => `${prefix}${slug}-${suffix}`
  )

  // 3. Guard: never emit a stack that would collide with another project.
  const offenders = findUnnamespacedContainerNames(output, slug)
  if (offenders.length > 0) {
    throw new UnnamespacedContainerError(slug, offenders)
  }

  return output
}

/** Filename (relative to the compose file) holding a project's edge-function secrets. */
export const FUNCTIONS_ENV_FILE = '.env.functions'

/**
 * Ensure the `functions` service loads the project's edge-function secrets file.
 *
 * The edge-runtime service only reads a fixed allowlist of `environment:` keys, so
 * user secrets in the stack `.env` never reach `Deno.env.get()`. Adding an
 * `env_file` entry (Supabase's self-hosting approach) makes `docker/.env.functions`
 * available to the functions container only.
 *
 * Pure and idempotent: if an `env_file` already lists the file, the content is
 * returned unchanged, so it is safe to run on both fresh and already-generated
 * stacks (backfill).
 */
export function ensureFunctionsEnvFile(composeContent: string): string {
  const serviceMatch = composeContent.match(/^([ \t]*)functions:[ \t]*$/m)
  if (!serviceMatch) {
    throw new Error('Cannot add edge-function env_file: no `functions:` service in the compose file')
  }

  // Already wired up (idempotent) — the file appears anywhere in the document.
  if (composeContent.includes(FUNCTIONS_ENV_FILE)) {
    return composeContent
  }

  // Insert as the first key under the service, indented one level past `functions:`.
  const serviceIndent = serviceMatch[1]
  const keyIndent = `${serviceIndent}  `
  const block = `\n${keyIndent}env_file:\n${keyIndent}  - ${FUNCTIONS_ENV_FILE}`
  return composeContent.replace(serviceMatch[0], `${serviceMatch[0]}${block}`)
}
