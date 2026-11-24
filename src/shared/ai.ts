/**
 * AI connections. CLI providers run the user's own installed tools (Claude Code,
 * Codex, Gemini CLI) so their existing subscription sign-in is used; API providers
 * use keys the user pastes in, stored encrypted on this machine.
 */
export type ProviderId = 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'anthropic-api' | 'openai-api' | 'gemini-api'

/** Order used when no default is chosen: the first available one wins. */
export const PROVIDER_ORDER: ProviderId[] = ['claude-cli', 'codex-cli', 'gemini-cli', 'anthropic-api', 'openai-api', 'gemini-api']

export interface ProviderInfo {
  id: ProviderId
  label: string
  /** Who makes it, shown under the label. */
  vendor: string
  kind: 'cli' | 'api'
  /** Model used when the field is left empty. Empty for CLIs: they use their own default. */
  defaultModel: string
  modelPlaceholder: string
  /** CLI: how to install it. API: where to get a key. */
  hint: string
  /** API only: the provider's page for creating a key. */
  keyUrl?: string
  supportsWebSearch: boolean
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  'claude-cli': {
    id: 'claude-cli',
    label: 'Claude Code',
    vendor: 'Anthropic',
    kind: 'cli',
    defaultModel: '',
    modelPlaceholder: 'Claude Code default',
    hint: 'Install Claude Code from claude.com/claude-code, then run `claude` once to sign in.',
    supportsWebSearch: true,
  },
  'codex-cli': {
    id: 'codex-cli',
    label: 'Codex',
    vendor: 'OpenAI',
    kind: 'cli',
    defaultModel: '',
    modelPlaceholder: 'Codex default',
    hint: 'Run `npm install -g @openai/codex`, then run `codex` once to sign in.',
    supportsWebSearch: true,
  },
  'gemini-cli': {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    vendor: 'Google',
    kind: 'cli',
    defaultModel: '',
    modelPlaceholder: 'Gemini CLI default',
    hint: 'Run `npm install -g @google/gemini-cli`, then run `gemini` once to sign in.',
    supportsWebSearch: true,
  },
  'anthropic-api': {
    id: 'anthropic-api',
    label: 'Claude API',
    vendor: 'Anthropic',
    kind: 'api',
    defaultModel: 'claude-opus-5-5',
    modelPlaceholder: 'claude-opus-5-5',
    hint: 'Create a key at platform.claude.com.',
    keyUrl: 'https://platform.claude.com/settings/keys',
    supportsWebSearch: true,
  },
  'openai-api': {
    id: 'openai-api',
    label: 'OpenAI API',
    vendor: 'OpenAI',
    kind: 'api',
    defaultModel: 'gpt-6.2-astra',
    modelPlaceholder: 'gpt-6.2-astra',
    hint: 'Create a key at platform.openai.com.',
    keyUrl: 'https://platform.openai.com/api-keys',
    supportsWebSearch: true,
  },
  'gemini-api': {
    id: 'gemini-api',
    label: 'Gemini API',
    vendor: 'Google',
    kind: 'api',
    defaultModel: 'gemini-3.8-flash',
    modelPlaceholder: 'gemini-3.8-flash',
    hint: 'Create a key at aistudio.google.com.',
    keyUrl: 'https://aistudio.google.com/apikey',
    supportsWebSearch: true,
  },
}

export function isProviderId(x: unknown): x is ProviderId {
  return typeof x === 'string' && (PROVIDER_ORDER as string[]).includes(x)
}

/**
 * The provider AI features use right now: the saved default if it is available,
 * else the first available one in PROVIDER_ORDER. Null when none is.
 */
export function activeProvider(statuses: Pick<ProviderStatus, 'id' | 'available'>[], defaultProvider: ProviderId | null): ProviderId | null {
  const available = new Set(statuses.filter((s) => s.available).map((s) => s.id))
  if (defaultProvider && available.has(defaultProvider)) return defaultProvider
  return PROVIDER_ORDER.find((id) => available.has(id)) ?? null
}

export interface ProviderStatus {
  id: ProviderId
  label: string
  kind: 'cli' | 'api'
  /** Installed (CLI) or has a key saved (API). */
  available: boolean
  /** Human-readable state, e.g. "Claude Code 2.1.3" or "No key saved". */
  detail: string
  /** Model that will be used: the saved one, else the provider default ('' = the CLI's own default). */
  model: string
  supportsWebSearch: boolean
  /** CLI only: version string reported by `--version`. */
  version?: string
  /** API only: a key is saved. */
  hasKey?: boolean
}

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiRequest {
  system?: string
  messages: AiMessage[]
  /** Defaults to the provider chosen in settings. */
  provider?: ProviderId
  /** Ask for a single JSON value as the reply. */
  json?: boolean
  /** Allow the provider's own web search, where it has one. */
  webSearch?: boolean
  /** Overrides the model saved in settings for this call. */
  model?: string
  /** Give up after this long. Defaults: 3 minutes, 6 with web search. */
  timeoutMs?: number
}

export interface AiResult {
  text: string
  provider: ProviderId
  model: string
}

export interface AiSettings {
  defaultProvider: ProviderId | null
  models: Partial<Record<ProviderId, string>>
}

export interface AiChannels {
  'ai:status': { req: void; res: ProviderStatus[] }
  'ai:getSettings': { req: void; res: AiSettings }
  'ai:saveSettings': { req: AiSettings; res: AiSettings }
  'ai:setKey': { req: { provider: ProviderId; key: string }; res: ProviderStatus[] }
  'ai:clearKey': { req: { provider: ProviderId }; res: ProviderStatus[] }
  /** Sends a one-line prompt to check a provider works. */
  'ai:test': { req: { provider: ProviderId }; res: { ok: boolean; detail: string } }
}

export interface AiEvents {}
