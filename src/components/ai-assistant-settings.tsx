'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Provider {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  keyHint: string
}

interface Settings {
  configured: boolean
  provider: string
  model: string
  baseUrl: string
  hasKey: boolean
}

/**
 * Point this project's built-in Studio assistant at your own AI provider.
 *
 * Studio's assistant is upstream, and it only ever reads `OPENAI_API_KEY` and `OPENAI_BASE_URL` — so
 * the work here is telling the project which provider to use and whose key pays for it. For anything
 * other than OpenAI, the panel relays the call and substitutes the model name, because the assistant
 * asks for a hard-coded OpenAI model id that no other provider recognises.
 *
 * The key is write-only: it goes in, and the panel tells you only whether one is on file.
 */
export function AiAssistantSettings({ projectId }: { projectId: string }) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [provider, setProvider] = useState('deepseek')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch(`/api/projects/${projectId}/ai`)
        if (!response.ok) {
          if (response.status === 403) {
            setError('You do not have permission to view this project’s AI settings.')
            return
          }
          throw new Error(`Could not load settings (${response.status})`)
        }
        const data = await response.json()
        if (cancelled) return
        setProviders(data.providers ?? [])
        setSettings(data.settings ?? null)
        if (data.settings?.provider) {
          setProvider(data.settings.provider)
          setModel(data.settings.model ?? '')
          setBaseUrl(data.settings.baseUrl ?? '')
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load settings')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const selected = providers.find((p) => p.id === provider)

  function chooseProvider(id: string) {
    setProvider(id)
    const next = providers.find((p) => p.id === id)
    // Pre-fill from the preset so the common case needs only a key. Switching back to an already
    // configured provider keeps what the user typed rather than overwriting it with the default.
    if (next && (!settings?.configured || settings.provider !== id)) {
      setBaseUrl(next.baseUrl)
      setModel(next.defaultModel)
    }
  }

  async function submit(action: 'save' | 'clear') {
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const response = await fetch(`/api/projects/${projectId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'clear' ? { action: 'clear' } : { provider, model, baseUrl, apiKey }
        ),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? `Could not save (${response.status})`)
        return
      }
      setSettings(data.settings ?? null)
      setApiKey('')
      setSaved(
        action === 'clear'
          ? 'Assistant switched off. The project’s Studio was restarted.'
          : `Saved. Studio was restarted and will use ${data.settings?.provider} (${data.settings?.model}).`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>🤖 AI Assistant</CardTitle>
        <CardDescription>
          Use Studio’s built-in AI assistant with your own provider and key — OpenAI, or DeepSeek,
          Qwen, Kimi and GLM. The key is stored in the panel and never given to the project’s
          containers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status:</span>
          {settings?.configured ? (
            <span className="text-green-500">
              On — {settings.provider} · {settings.model}
            </span>
          ) : (
            <span className="text-muted-foreground">Off</span>
          )}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}
        {saved && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-500 px-3 py-2 rounded text-sm">
            {saved}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="ai_provider">Provider</Label>
            <select
              id="ai_provider"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={provider}
              onChange={(event) => chooseProvider(event.target.value)}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="ai_model">Model</Label>
            <Input
              id="ai_model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={selected?.defaultModel || 'model-id'}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Whatever your provider calls it — e.g. <code>deepseek-flash</code>.
            </p>
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="ai_base_url">Base URL</Label>
            <Input
              id="ai_base_url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={selected?.baseUrl || 'leave empty for OpenAI'}
              disabled={provider === 'openai'}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {provider === 'openai'
                ? 'OpenAI needs no base URL.'
                : 'The OpenAI-compatible endpoint of your provider, ending in /v1.'}
            </p>
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="ai_api_key">API key</Label>
            <Input
              id="ai_api_key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings?.hasKey ? '•••••••• (saved — leave blank to keep)' : 'paste your key'}
              autoComplete="off"
            />
            {selected && (
              <p className="text-xs text-muted-foreground mt-1">
                Get a key at {selected.keyHint}.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <Button onClick={() => submit('save')} disabled={busy || !provider}>
            {busy ? 'Saving…' : settings?.configured ? 'Save changes' : 'Turn on assistant'}
          </Button>
          {settings?.configured && (
            <Button variant="outline" onClick={() => submit('clear')} disabled={busy}>
              Turn off
            </Button>
          )}
        </div>

        {provider !== 'openai' && (
          <p className="text-xs text-muted-foreground">
            Studio asks for an OpenAI model name that your provider would reject, so the panel
            rewrites the model on the way through. Nothing else about the request is changed.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
