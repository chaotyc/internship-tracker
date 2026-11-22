import {
  PROVIDER_ORDER,
  PROVIDERS,
  isProviderId,
  type AiRequest,
  type AiResult,
  type AiSettings,
  type ProviderId,
  type ProviderStatus,
} from '@shared/ai'
import { API_SPECS, runApi, type ApiSpec } from './api-providers'
import { CLI_SPECS, type CliSpec } from './cli-providers'
import { PresenceCache, nodeHost, runCli, type CliHost } from './cli-runner'
import { extractJson } from './text'

export interface CompleteOptions {
  /** Called with each new piece of text as it streams. */
  onDelta?: (delta: string) => void
  signal?: AbortSignal
}

/** What other features use to talk to a model. Implemented by the ai feature. */
export interface AiService {
  complete(req: AiRequest, opts?: CompleteOptions): Promise<AiResult>
  /** Asks for JSON and parses the reply; throws with a readable message if it isn't JSON. */
  json<T>(req: AiRequest, opts?: CompleteOptions): Promise<T>
  status(): Promise<ProviderStatus[]>
}

const NOT_SET_UP = 'No AI connection is set up yet. Open Settings, then AI connections.'
const SETTINGS_KEY = 'ai.settings'
const keyName = (id: ProviderId) => `ai.key.${id}`

/** The parts of ctx.secrets / ctx.settings this service needs (tests pass fakes). */
export interface AiDeps {
  secrets: { get(key: string): string | null; has(key: string): boolean; set(key: string, value: string): void; delete(key: string): void }
  settings: { get<T>(key: string, fallback: T): T; set<T>(key: string, value: T): void }
  host?: CliHost
  fetchFn?: typeof fetch
  presence?: PresenceCache
}

/**
 * Which provider a request goes to: the one asked for, else the saved default if it
 * is available, else the first available in PROVIDER_ORDER. Null if none is.
 */
export async function chooseProvider(
  requested: ProviderId | undefined,
  defaultProvider: ProviderId | null,
  isAvailable: (id: ProviderId) => Promise<boolean>,
): Promise<ProviderId | null> {
  if (requested) return requested
  if (defaultProvider && (await isAvailable(defaultProvider))) return defaultProvider
  for (const id of PROVIDER_ORDER) if (await isAvailable(id)) return id
  return null
}

export function normalizeSettings(raw: unknown): AiSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<AiSettings>
  const models: AiSettings['models'] = {}
  if (s.models && typeof s.models === 'object') {
    for (const [id, m] of Object.entries(s.models)) {
      if (isProviderId(id) && typeof m === 'string' && m.trim()) models[id] = m.trim().slice(0, 200)
    }
  }
  return { defaultProvider: isProviderId(s.defaultProvider) ? s.defaultProvider : null, models }
}

export class AiServiceImpl implements AiService {
  private readonly host: CliHost
  readonly presence: PresenceCache

  constructor(private readonly deps: AiDeps) {
    this.host = deps.host ?? nodeHost
    this.presence = deps.presence ?? new PresenceCache(this.host)
  }

  /* ------------------------------- settings & keys ------------------------------- */

  getSettings(): AiSettings {
    return normalizeSettings(this.deps.settings.get<unknown>(SETTINGS_KEY, null))
  }

  saveSettings(next: AiSettings): AiSettings {
    const clean = normalizeSettings(next)
    this.deps.settings.set(SETTINGS_KEY, clean)
    return clean
  }

  setKey(id: ProviderId, key: string): void {
    if (PROVIDERS[id]?.kind !== 'api') throw new Error('That connection does not use a key.')
    const k = key.trim()
    if (!k) throw new Error('Paste a key first.')
    if (/\s/.test(k) || k.length > 512) throw new Error("That doesn't look like an API key.")
    this.deps.secrets.set(keyName(id), k)
  }

  clearKey(id: ProviderId): void {
    this.deps.secrets.delete(keyName(id))
  }

  /* ----------------------------------- status ----------------------------------- */

  modelFor(id: ProviderId, settings = this.getSettings()): string {
    return settings.models[id] ?? PROVIDERS[id].defaultModel
  }

  async providerStatus(id: ProviderId, settings = this.getSettings()): Promise<ProviderStatus> {
    const info = PROVIDERS[id]
    const base = { id, label: info.label, kind: info.kind, model: this.modelFor(id, settings), supportsWebSearch: info.supportsWebSearch }
    if (info.kind === 'cli') {
      const spec = CLI_SPECS[id as CliSpec['id']]
      const p = await this.presence.get(spec.bin)
      return {
        ...base,
        available: p.installed,
        detail: p.installed ? `${spec.name}${p.version ? ` ${p.version}` : ''}` : 'Not installed',
        ...(p.version ? { version: p.version } : {}),
      }
    }
    const hasKey = this.deps.secrets.has(keyName(id))
    return { ...base, available: hasKey, hasKey, detail: hasKey ? 'Key saved' : 'No key saved' }
  }

  async status(): Promise<ProviderStatus[]> {
    const settings = this.getSettings()
    return Promise.all(PROVIDER_ORDER.map((id) => this.providerStatus(id, settings)))
  }

  /* --------------------------------- completion --------------------------------- */

  async complete(req: AiRequest, opts: CompleteOptions = {}): Promise<AiResult> {
    if (!req.messages?.length) throw new Error('Nothing to send: the request has no messages.')
    const settings = this.getSettings()
    const statuses = new Map<ProviderId, Promise<ProviderStatus>>()
    const statusOf = (id: ProviderId) => {
      if (!statuses.has(id)) statuses.set(id, this.providerStatus(id, settings))
      return statuses.get(id)!
    }
    const id = await chooseProvider(req.provider, settings.defaultProvider, async (p) => (await statusOf(p)).available)
    if (!id) throw new Error(NOT_SET_UP)
    const st = await statusOf(id)
    const info = PROVIDERS[id]
    if (!st.available) {
      throw new Error(
        info.kind === 'cli'
          ? `${info.label} isn't installed on this computer. ${info.hint}`
          : `${info.label} has no key saved. Add one in Settings, then AI connections.`,
      )
    }
    const model = (req.model ?? '').trim() || this.modelFor(id, settings)
    if (info.kind === 'api' && !model) throw new Error(`${info.label} needs a model name. Add one in Settings, then AI connections.`)

    const timeoutMs = req.timeoutMs ?? (req.webSearch ? 6 * 60_000 : 3 * 60_000)
    let text: string
    if (info.kind === 'cli') {
      text = await this.runCliProvider(CLI_SPECS[id as CliSpec['id']], req, model, timeoutMs, opts)
    } else {
      text = await this.runApiProvider(API_SPECS[id as ApiSpec['id']], req, model, timeoutMs, opts)
    }
    return { text, provider: id, model: model || 'default' }
  }

  async json<T>(req: AiRequest, opts?: CompleteOptions): Promise<T> {
    const res = await this.complete({ ...req, json: true }, opts)
    return extractJson<T>(res.text)
  }

  /** Sends a one-line prompt and reports whether a reply came back. */
  async test(id: ProviderId): Promise<{ ok: boolean; detail: string }> {
    if (PROVIDERS[id]?.kind === 'cli') this.presence.clear()
    const started = Date.now()
    try {
      const res = await this.complete({
        provider: id,
        messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        timeoutMs: 90_000,
      })
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      const reply = res.text.trim()
      if (!reply) return { ok: false, detail: 'Connected, but the reply was empty.' }
      const shown = reply.length > 40 ? `${reply.slice(0, 40)}…` : reply
      return { ok: true, detail: `Replied “${shown}” in ${secs} s` }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
  }

  private async runCliProvider(spec: CliSpec, req: AiRequest, model: string, timeoutMs: number, opts: CompleteOptions): Promise<string> {
    const presence = await this.presence.get(spec.bin)
    if (!presence.path) throw new Error(`${spec.name} isn't installed on this computer.`)
    const parser = spec.parser()
    const res = await runCli(
      {
        bin: presence.path,
        args: [],
        argsFor: (dir) => spec.args(req, model, dir),
        files: spec.files?.(req),
        stdin: spec.stdin(req),
        timeoutMs,
        signal: opts.signal,
        onLine: (line) => {
          const delta = parser.line(line)
          if (delta) opts.onDelta?.(delta)
        },
      },
      this.host,
    )
    return parser.finish(res.code, res.stderr)
  }

  private async runApiProvider(spec: ApiSpec, req: AiRequest, model: string, timeoutMs: number, opts: CompleteOptions): Promise<string> {
    const key = this.deps.secrets.get(keyName(spec.id))
    if (!key) throw new Error(`${spec.name}: the saved key couldn't be read. Save it again in Settings, then AI connections.`)
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    try {
      return await runApi(spec, req, model, key, { onDelta: opts.onDelta, signal, fetchFn: this.deps.fetchFn })
    } catch (err) {
      if (timeout.aborted && !opts.signal?.aborted) throw new Error(`${spec.name}: no reply after ${Math.round(timeoutMs / 1000)} seconds, so it was stopped.`)
      if (opts.signal?.aborted) {
        const e = new Error('Stopped.')
        e.name = 'AbortError'
        throw e
      }
      if (err instanceof TypeError && /fetch/i.test(err.message)) throw new Error(`${spec.name}: couldn't reach the server. Check your internet connection.`)
      throw err
    }
  }
}

/** Always fails with the "not set up" message. Kept for tests in other features that need an AiService without a model. */
export class StubAiService implements AiService {
  async complete(): Promise<AiResult> {
    throw new Error(NOT_SET_UP)
  }
  async json<T>(): Promise<T> {
    throw new Error(NOT_SET_UP)
  }
  async status(): Promise<ProviderStatus[]> {
    return []
  }
}
