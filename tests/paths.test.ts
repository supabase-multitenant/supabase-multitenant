import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DB_IDENTIFIER,
  DEFAULT_DATA_DIR,
  DOCKER_IMAGE,
  ENV_DATA_PATH,
  ENV_MODE,
  NETWORK_NAME,
  PANEL_CONTAINER_NAME,
  POSTGRES_CONTAINER_NAME,
  PRODUCT_NAME,
  PRODUCT_SLUG,
  TRAEFIK_CONTAINER_NAME,
  getCoreBasePath,
  getMode,
  getProjectsBasePath,
  getTraefikDynamicPath,
} from '../src/lib/paths'

describe('product identity constants', () => {
  it('uses the canonical supabase-multitenant slug', () => {
    expect(PRODUCT_SLUG).toBe('supabase-multitenant')
    expect(PRODUCT_NAME).toBe('Supabase Multitenant')
  })

  it('names containers/network consistently with the slug', () => {
    expect(PANEL_CONTAINER_NAME).toBe('supabase-multitenant-panel')
    expect(POSTGRES_CONTAINER_NAME).toBe('supabase-multitenant-postgres')
    expect(TRAEFIK_CONTAINER_NAME).toBe('supabase-multitenant-traefik')
    expect(NETWORK_NAME).toBe('supabase-multitenant-network')
  })

  it('keeps the Docker image registry namespace', () => {
    expect(DOCKER_IMAGE).toBe('alanmf30/supabase-multitenant')
  })

  it('uses an underscore identifier for the Postgres user/database', () => {
    expect(DB_IDENTIFIER).toBe('supabase_multitenant')
  })
})

describe('path helpers', () => {
  beforeEach(() => {
    vi.stubEnv(ENV_MODE, 'development')
    vi.stubEnv(ENV_DATA_PATH, '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to development mode', () => {
    vi.stubEnv(ENV_MODE, '')
    expect(getMode()).toBe('development')
    expect(getMode()).not.toBe('production')
  })

  it('resolves local project/core paths in development mode', () => {
    vi.stubEnv(ENV_MODE, 'development')
    expect(getProjectsBasePath()).toBe(path.join(process.cwd(), 'supabase-projects'))
    expect(getCoreBasePath()).toBe(path.join(process.cwd(), 'supabase-core'))
    expect(getTraefikDynamicPath()).toBe(path.join(process.cwd(), 'traefik', 'dynamic'))
  })

  it('uses DATA_PATH under the configured data dir in production mode', () => {
    vi.stubEnv(ENV_MODE, 'production')
    vi.stubEnv(ENV_DATA_PATH, '/var/lib/smt')
    expect(getProjectsBasePath()).toBe(path.join('/var/lib/smt', 'projects'))
    expect(getCoreBasePath()).toBe(path.join('/var/lib/smt', 'core'))
  })

  it('falls back to the default data directory in production when DATA_PATH is unset', () => {
    vi.stubEnv(ENV_MODE, 'production')
    vi.stubEnv(ENV_DATA_PATH, '')
    expect(DEFAULT_DATA_DIR).toBe('/etc/supabase-multitenant')
    expect(getProjectsBasePath()).toBe(path.join(DEFAULT_DATA_DIR, 'projects'))
    expect(getCoreBasePath()).toBe(path.join(DEFAULT_DATA_DIR, 'core'))
    expect(getTraefikDynamicPath()).toBe(path.join(DEFAULT_DATA_DIR, 'traefik', 'dynamic'))
  })
})
