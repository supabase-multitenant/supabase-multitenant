import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  AI_SETTING_KEYS,
  findProvider,
  needsModelRewrite,
  studioAiEnv,
  validateAiSettings,
} from '@/lib/ai-providers'
import { ensureStudioAiEnv } from '@/lib/compose'
import { prisma } from '@/lib/db'
import { mergeEnvFile } from '@/lib/env-file'
import { getProjectsBasePath } from '@/lib/paths'
import { recreateServices } from '@/lib/service-groups'

/**
 * A project's AI provider configuration.
 *
 * Stored in the panel's own `panel_settings` table rather than in the project's environment
 * variables, because these are decisions the *panel* makes on the project's behalf. The user's
 * provider key must not end up in the project's `.env`: that file is handed to every container in
 * the project, and the only thing Studio actually needs from us is a base URL and a token.
 */

export interface StoredAiSettings {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  token: string
}

export interface AiSettingsView {
  configured: boolean
  provider: string
  model: string
  baseUrl: string
  /** Whether a key is on file. The key itself is never returned to a client. */
  hasKey: boolean
}

const settingsKey = (projectId: string, field: string) => `ai:${projectId}:${field}`

/** The panel's own public origin, which is what the Studio container must call back to. */
export function panelPublicUrl(): string {
  return (process.env.AUTH_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
}

export function proxyBaseUrlFor(projectId: string): string {
  return `${panelPublicUrl()}/api/ai/${projectId}`
}

export async function readAiSettings(projectId: string): Promise<StoredAiSettings> {
  const rows = await prisma.panelSettings.findMany({
    where: { key: { startsWith: `ai:${projectId}:` } },
    select: { key: true, value: true },
  })
  const values = new Map(
    rows.map((row) => [row.key.slice(`ai:${projectId}:`.length), row.value])
  )
  const read = (field: string) => values.get(field) ?? ''

  return {
    provider: read('provider'),
    apiKey: read('api_key'),
    baseUrl: read('base_url'),
    model: read('model'),
    token: read('token'),
  }
}

/** What the panel shows: the shape of the configuration, never the secret. */
export function toView(settings: StoredAiSettings): AiSettingsView {
  return {
    configured: Boolean(settings.provider && settings.apiKey && settings.model),
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    hasKey: Boolean(settings.apiKey),
  }
}


export interface SaveResult {
  ok: boolean
  error?: string
  view?: AiSettingsView
  recreated?: string[]
}

/**
 * Store a project's AI provider settings and make the running Studio pick them up.
 *
 * Env changes only reach a container when it is recreated, so the Studio service is recreated here
 * — deliberately by itself, via `recreateServices`, so this cannot disturb the data plane.
 */
export async function saveAiSettings(
  projectId: string,
  input: { provider?: string; apiKey?: string; baseUrl?: string; model?: string }
): Promise<SaveResult> {
  const existing = await readAiSettings(projectId)
  const providerId = (input.provider ?? existing.provider).trim().toLowerCase()
  const provider = findProvider(providerId)
  if (!provider) return { ok: false, error: 'Choose a provider.' }

  // A key is only re-entered when the user changes it; a blank field keeps the stored one, so the
  // panel never has to send a secret back to the browser to be re-submitted.
  const apiKey = (input.apiKey ?? '').trim() || existing.apiKey
  const baseUrl = (input.baseUrl ?? '').trim() || provider.baseUrl
  const model = (input.model ?? '').trim() || provider.defaultModel

  const problem = validateAiSettings({ provider: providerId, apiKey, baseUrl, model })
  if (problem) return { ok: false, error: problem }

  if (needsModelRewrite(providerId) && !panelPublicUrl()) {
    return {
      ok: false,
      error:
        'The panel has no public URL configured (AUTH_URL), so Studio cannot call back to rewrite the model name.',
    }
  }

  const token = existing.token || randomBytes(32).toString('base64url')

  for (const [field, value] of Object.entries({
    provider: providerId,
    api_key: apiKey,
    base_url: baseUrl,
    model,
    token,
  })) {
    await prisma.panelSettings.upsert({
      where: { key: settingsKey(projectId, field) },
      update: { value },
      create: { key: settingsKey(projectId, field), value },
    })
  }

  const recreated = await applyToStudio(projectId, { provider: providerId, apiKey, token })

  return {
    ok: true,
    view: toView({ provider: providerId, apiKey, baseUrl, model, token }),
    recreated,
  }
}

/** Turn the assistant off and restore the panel's default environment for the project. */
export async function clearAiSettings(projectId: string): Promise<SaveResult> {
  await prisma.panelSettings.deleteMany({ where: { key: { startsWith: `ai:${projectId}:` } } })

  const recreated = await applyToStudio(projectId, null)

  return { ok: true, view: toView(await readAiSettings(projectId)), recreated }
}

/**
 * Put the two environment variables Studio reads into the project, and recreate the container.
 *
 * `settings === null` clears them, which is how the assistant is switched off again.
 */
async function applyToStudio(
  projectId: string,
  settings: { provider: string; apiKey: string; token: string } | null
): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { slug: true },
  })
  if (!project) return []

  const env = settings
    ? studioAiEnv(settings, proxyBaseUrlFor(projectId))
    : { OPENAI_API_KEY: '', OPENAI_BASE_URL: null as string | null }

  const entries: Record<string, string | null> = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_BASE_URL: env.OPENAI_BASE_URL || null,
  }

  // The database is the panel's record of the project's variables; the file is what Docker reads.
  // Both are written so the two cannot drift, whichever one a later code path reads.
  for (const [key, value] of Object.entries(entries)) {
    if (value === null) {
      await prisma.projectEnvVar.deleteMany({ where: { projectId, key } })
      continue
    }
    await prisma.projectEnvVar.upsert({
      where: { projectId_key: { projectId, key } },
      update: { value },
      create: { projectId, key, value },
    })
  }

  const dockerDir = path.join(getProjectsBasePath(), project.slug, 'docker')
  await mergeEnvFile(path.join(dockerDir, '.env'), entries)

  // Projects created before this feature have a compose whose studio service takes no base URL, so
  // the variable would land in .env and never reach the container. Ensuring it here — idempotently —
  // fixes existing projects the moment their AI settings are saved.
  const composePath = path.join(dockerDir, 'docker-compose.yml')
  try {
    const compose = await fs.readFile(composePath, 'utf8')
    const ensured = ensureStudioAiEnv(compose)
    if (ensured !== compose) await fs.writeFile(composePath, ensured)
  } catch {
    // No compose on disk: the recreate below will find no studio service either, and reports that.
  }

  return recreateServices(dockerDir, ['studio'])
}
