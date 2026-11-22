/**
 * AI connections. CLI providers run the user's own installed tools (Claude Code,
 * Codex, Gemini CLI) so their existing subscription sign-in is used; API providers
 * use keys the user pastes in, stored encrypted on this machine.
 */
export type ProviderId = 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'anthropic-api' | 'openai-api' | 'gemini-api'

export interface ProviderStatus {
  id: ProviderId
  label: string
  kind: 'cli' | 'api'
  /** Installed (CLI) or has a key saved (API). */
  available: boolean
  /** Human-readable state, e.g. "claude 2.1.3 found" or "No key saved". */
  detail: string
  model: string
  supportsWebSearch: boolean
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
