import { describe, expect, it } from 'vitest'

import {
  AI_PROVIDERS,
  findProvider,
  needsModelRewrite,
  studioAiEnv,
  validateAiSettings,
} from '@/lib/ai-providers'

describe('AI providers', () => {
  it('offers the providers that were asked for', () => {
    const ids = AI_PROVIDERS.map((p) => p.id)
    // The four named explicitly, plus OpenAI itself and an escape hatch. A provider silently
    // disappearing from this list would take a working configuration option with it.
    for (const required of ['openai', 'deepseek', 'qwen', 'kimi', 'glm']) {
      expect(ids).toContain(required)
    }
  })

  it('gives every non-OpenAI provider a base URL, since without one it cannot be reached', () => {
    for (const provider of AI_PROVIDERS) {
      if (provider.id === 'custom') continue
      if (provider.id === 'openai') {
        // Empty means "use the SDK's own default" — it must not be sent as an empty env value.
        expect(provider.baseUrl).toBe('')
        continue
      }
      expect(provider.baseUrl).toMatch(/^https:\/\//)
      expect(provider.defaultModel).not.toBe('')
    }
  })

  it('does not list Anthropic, whose API cannot serve the assistant', () => {
    // Studio's assistant speaks the Responses API; Anthropic does not implement it. A preset here
    // would be a setting that looks configurable and can never work.
    expect(AI_PROVIDERS.map((p) => p.id)).not.toContain('anthropic')
  })

  describe('needsModelRewrite', () => {
    it('leaves OpenAI alone — its own model ids are what Studio sends', () => {
      expect(needsModelRewrite('openai')).toBe(false)
    })

    it('rewrites for every other provider, which would reject an OpenAI model id', () => {
      for (const id of ['deepseek', 'qwen', 'kimi', 'glm', 'custom']) {
        expect(needsModelRewrite(id)).toBe(true)
      }
    })
  })

  describe('validateAiSettings', () => {
    const valid = {
      provider: 'deepseek',
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
    }

    it('accepts a complete configuration', () => {
      expect(validateAiSettings(valid)).toBeNull()
    })

    it('accepts OpenAI with no base URL', () => {
      expect(validateAiSettings({ ...valid, provider: 'openai', baseUrl: '' })).toBeNull()
    })

    it('refuses a provider it does not know', () => {
      expect(validateAiSettings({ ...valid, provider: 'nope' })).toMatch(/provider/i)
    })

    it('refuses a missing key or model rather than switching on an assistant that will fail', () => {
      expect(validateAiSettings({ ...valid, apiKey: '' })).toMatch(/key/i)
      expect(validateAiSettings({ ...valid, model: '' })).toMatch(/model/i)
    })

    it('refuses a non-OpenAI provider without a base URL', () => {
      expect(validateAiSettings({ ...valid, baseUrl: '' })).toMatch(/base url/i)
    })

    it('refuses a base URL that is not a URL', () => {
      expect(validateAiSettings({ ...valid, baseUrl: 'api.deepseek.com' })).toMatch(/http/i)
    })
  })

  describe('studioAiEnv', () => {
    it('hands OpenAI the user key directly, with no base URL override', () => {
      const env = studioAiEnv(
        { provider: 'openai', apiKey: 'sk-openai', token: 'internal-token' },
        'https://panel.example.com/api/ai/proj'
      )
      expect(env.OPENAI_API_KEY).toBe('sk-openai')
      expect(env.OPENAI_BASE_URL).toBe('')
    })

    it('never hands a non-OpenAI provider key to the container', () => {
      const env = studioAiEnv(
        { provider: 'deepseek', apiKey: 'sk-deepseek-secret', token: 'internal-token' },
        'https://panel.example.com/api/ai/proj'
      )
      // The key stays in the panel; Studio only ever sees the token that identifies the project.
      expect(env.OPENAI_API_KEY).toBe('internal-token')
      expect(env.OPENAI_API_KEY).not.toContain('sk-deepseek-secret')
      expect(env.OPENAI_BASE_URL).toBe('https://panel.example.com/api/ai/proj/v1')
    })

    it('treats an unknown provider as one needing the relay', () => {
      const env = studioAiEnv(
        { provider: 'mystery', apiKey: 'secret', token: 'tok' },
        'https://panel.example.com/api/ai/proj'
      )
      expect(env.OPENAI_API_KEY).toBe('tok')
      expect(env.OPENAI_BASE_URL).not.toBe('')
    })
  })

  it('resolves provider ids case-insensitively and rejects nullish input', () => {
    expect(findProvider('DeepSeek')?.id).toBe('deepseek')
    expect(findProvider(null)).toBeNull()
    expect(findProvider('')).toBeNull()
  })
})
