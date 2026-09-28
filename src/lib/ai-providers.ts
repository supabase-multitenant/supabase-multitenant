/**
 * AI providers a project's Studio assistant can be pointed at.
 *
 * Studio's assistant is upstream code built on the Vercel AI SDK's OpenAI provider in
 * **Responses API** mode, so a provider is usable only if it serves `POST /responses` at an
 * OpenAI-shaped path. Every preset below does; it was verified by calling each one, not assumed.
 *
 * The assistant also sends a **hard-coded model id** (`gpt-5.6-luna` and friends — there is no
 * environment variable for it). A non-OpenAI provider rejects that with a 400, which is the entire
 * reason this module exists: the model name has to be rewritten in flight, and that rewrite is the
 * only thing `needsModelRewrite` decides.
 *
 * Anthropic is deliberately absent. Its API does not implement the Responses API, so listing it
 * would put a setting in front of a user that cannot work.
 */

export interface AiProvider {
  /** Stored value in the project's `AI_PROVIDER` variable. */
  id: string
  /** Shown in the panel. */
  label: string
  /**
   * Base URL that Studio talks to. For `openai` this is left empty, meaning the SDK's own default
   * (`https://api.openai.com/v1`) — an empty value must not be sent as an empty `OPENAI_BASE_URL`.
   */
  baseUrl: string
  /** Offered as the default model; the user can override it. */
  defaultModel: string
  /** Where a user gets a key, shown as a hint in the panel. */
  keyHint: string
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: '',
    defaultModel: 'gpt-5.6-luna',
    keyHint: 'platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-flash',
    keyHint: 'platform.deepseek.com',
  },
  {
    id: 'qwen',
    label: 'Qwen (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    keyHint: 'bailian.console.aliyun.com',
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    keyHint: 'platform.moonshot.cn',
  },
  {
    id: 'glm',
    label: 'GLM (Zhipu)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    keyHint: 'open.bigmodel.cn',
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible',
    baseUrl: '',
    defaultModel: '',
    keyHint: 'any endpoint that serves the Responses API',
  },
]

/** Reserved project environment variables this feature owns. */
export const AI_SETTING_KEYS = {
  provider: 'AI_PROVIDER',
  apiKey: 'AI_API_KEY',
  baseUrl: 'AI_BASE_URL',
  model: 'AI_MODEL',
  /** What Studio presents as its key: an internal token, never the provider's key. */
  token: 'AI_PROXY_TOKEN',
} as const

export interface AiSettings {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  token: string
}

export function findProvider(id: string | null | undefined): AiProvider | null {
  if (!id) return null
  return AI_PROVIDERS.find((p) => p.id === id.trim().toLowerCase()) ?? null
}

/**
 * Does the request's model name need rewriting before it reaches the provider?
 *
 * OpenAI accepts its own ids, so nothing is rewritten there — which keeps the direct path free of
 * our code and means a plain OpenAI key behaves exactly as upstream intends. Every other provider
 * needs the substitution.
 */
export function needsModelRewrite(providerId: string): boolean {
  return providerId.trim().toLowerCase() !== 'openai'
}

/**
 * Is this configuration complete enough to switch the assistant on?
 *
 * A key with no model, or a non-OpenAI provider with no base URL, would produce an assistant that
 * looks configured and fails on first use — worse than one that is visibly off.
 */
export function validateAiSettings(input: Partial<AiSettings>): string | null {
  const provider = findProvider(input.provider)
  if (!provider) return 'Choose a provider.'

  if (!input.apiKey?.trim()) return 'An API key is required.'
  if (!input.model?.trim()) return 'A model name is required.'

  const baseUrl = input.baseUrl?.trim() ?? ''
  if (needsModelRewrite(provider.id) && !baseUrl) {
    return 'A base URL is required for every provider except OpenAI.'
  }
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return 'The base URL must start with http:// or https://'
  }
  return null
}

/**
 * The two environment variables the Studio container needs.
 *
 * For OpenAI these are the user's own key and no base URL, exactly as upstream expects. For
 * everything else Studio is given an internal token and pointed at our rewrite route, so the
 * provider's key stays in the panel and the route cannot be used by anyone else who finds it.
 */
export function studioAiEnv(
  settings: Pick<AiSettings, 'provider' | 'apiKey' | 'token'>,
  proxyBaseUrl: string
): { OPENAI_API_KEY: string; OPENAI_BASE_URL: string } {
  const provider = findProvider(settings.provider)
  const isOpenAi = provider !== null && !needsModelRewrite(provider.id)

  if (isOpenAi) {
    return { OPENAI_API_KEY: settings.apiKey, OPENAI_BASE_URL: '' }
  }
  return { OPENAI_API_KEY: settings.token, OPENAI_BASE_URL: `${proxyBaseUrl}/v1` }
}
