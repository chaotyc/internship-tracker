import type { AiRequest, ProviderId } from '@shared/ai'
import { systemFor } from './text'

/**
 * HTTP providers. Each one builds a streaming request and turns server-sent events
 * into text. Keys come from the caller (read from the OS keychain) and go only to
 * the provider's own endpoint.
 */
export interface ApiSpec {
  id: Extract<ProviderId, 'anthropic-api' | 'openai-api' | 'gemini-api'>
  name: string
  request: (req: AiRequest, model: string, key: string) => { url: string; init: RequestInit }
  parser: () => SseParser
}

export interface SseEvent {
  event: string
  data: string
}

export interface SseParser {
  /** Handles one event; returns new text to show. Throws on an error event. */
  event(ev: SseEvent): string
  finish(): string
}

/* ----------------------------------- SSE framing ---------------------------------- */

/** Splits a server-sent-events byte stream into events. */
export class SseDecoder {
  private buf = ''
  private eventName = ''
  private data: string[] = []

  push(chunk: string): SseEvent[] {
    this.buf += chunk
    const out: SseEvent[] = []
    let nl: number
    while ((nl = this.buf.search(/\r?\n/)) !== -1) {
      const line = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + (this.buf[nl] === '\r' ? 2 : 1))
      const ev = this.line(line)
      if (ev) out.push(ev)
    }
    return out
  }

  flush(): SseEvent[] {
    const out: SseEvent[] = []
    if (this.buf) {
      const ev = this.line(this.buf)
      this.buf = ''
      if (ev) out.push(ev)
    }
    const last = this.line('')
    if (last) out.push(last)
    return out
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      if (!this.data.length) {
        this.eventName = ''
        return null
      }
      const ev = { event: this.eventName || 'message', data: this.data.join('\n') }
      this.eventName = ''
      this.data = []
      return ev
    }
    if (line.startsWith(':')) return null
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.eventName = value
    else if (field === 'data') this.data.push(value)
    return null
  }
}

function json(data: string): Record<string, unknown> | null {
  if (!data || data === '[DONE]') return null
  try {
    return JSON.parse(data) as Record<string, unknown>
  } catch {
    return null
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' }

/* ------------------------------ Anthropic Messages API ----------------------------- */

export const anthropicApi: ApiSpec = {
  id: 'anthropic-api',
  name: 'Claude API',
  request: (req, model, key) => {
    const system = systemFor(req)
    const body: Record<string, unknown> = {
      model,
      max_tokens: 32000,
      stream: true,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    }
    if (system) body['system'] = system
    if (req.webSearch) body['tools'] = [{ type: 'web_search_20260318', name: 'web_search', max_uses: 5 }]
    return {
      url: 'https://api.anthropic.com/v1/messages',
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'x-api-key': key, 'anthropic-version': '2026-10-21' },
        body: JSON.stringify(body),
      },
    }
  },
  parser: () => new AnthropicSseParser(),
}

export class AnthropicSseParser implements SseParser {
  private text = ''
  private stopReason: string | null = null

  event(ev: SseEvent): string {
    const d = json(ev.data)
    if (!d) return ''
    const type = d['type'] ?? ev.event
    if (type === 'error') {
      const err = d['error'] as { message?: string } | undefined
      throw new Error(`Claude API: ${err?.message ?? 'the stream failed.'}`)
    }
    if (type === 'content_block_start') {
      const block = d['content_block'] as { type?: string } | undefined
      if (block?.type === 'text' && this.text && !this.text.endsWith('\n')) {
        this.text += '\n\n'
        return '\n\n'
      }
    }
    if (type === 'content_block_delta') {
      const delta = d['delta'] as { type?: string; text?: string } | undefined
      if (delta?.type === 'text_delta' && delta.text) {
        this.text += delta.text
        return delta.text
      }
    }
    if (type === 'message_delta') {
      const delta = d['delta'] as { stop_reason?: string } | undefined
      if (delta?.stop_reason) this.stopReason = delta.stop_reason
    }
    return ''
  }

  finish(): string {
    if (this.stopReason === 'refusal' && !this.text.trim()) throw new Error('Claude API: the model declined this request.')
    return this.text
  }
}

/* ------------------------------- OpenAI Responses API ------------------------------ */

export const openaiApi: ApiSpec = {
  id: 'openai-api',
  name: 'OpenAI API',
  request: (req, model, key) => {
    const system = systemFor(req)
    const body: Record<string, unknown> = {
      model,
      stream: true,
      store: false,
      input: req.messages.map((m) => ({ role: m.role, content: m.content })),
    }
    if (system) body['instructions'] = system
    if (req.webSearch) body['tools'] = [{ type: 'web_search' }]
    return {
      url: 'https://api.openai.com/v1/responses',
      init: { method: 'POST', headers: { ...JSON_HEADERS, authorization: `Bearer ${key}` }, body: JSON.stringify(body) },
    }
  },
  parser: () => new OpenAiSseParser(),
}

export class OpenAiSseParser implements SseParser {
  private text = ''
  private lastItem: string | null = null

  event(ev: SseEvent): string {
    const d = json(ev.data)
    if (!d) return ''
    const type = (d['type'] as string | undefined) ?? ev.event
    if (type === 'response.output_text.delta' && typeof d['delta'] === 'string') {
      // A new output message after a tool call starts a new paragraph.
      const item = typeof d['item_id'] === 'string' ? d['item_id'] : null
      let sep = ''
      if (item && this.lastItem && item !== this.lastItem && this.text && !this.text.endsWith('\n')) sep = '\n\n'
      this.lastItem = item ?? this.lastItem
      this.text += sep + d['delta']
      return sep + d['delta']
    }
    if (type === 'response.failed' || type === 'response.incomplete') {
      const response = d['response'] as { error?: { message?: string }; incomplete_details?: { reason?: string } } | undefined
      const msg = response?.error?.message ?? (response?.incomplete_details?.reason ? `stopped early (${response.incomplete_details.reason})` : null)
      if (type === 'response.failed' || !this.text) throw new Error(`OpenAI API: ${msg ?? 'the response failed.'}`)
    }
    if (type === 'error') {
      const msg = (d['message'] as string | undefined) ?? (d['error'] as { message?: string } | undefined)?.message
      throw new Error(`OpenAI API: ${msg ?? 'the stream failed.'}`)
    }
    return ''
  }

  finish(): string {
    return this.text
  }
}

/* ----------------------------------- Gemini API ----------------------------------- */

export const geminiApi: ApiSpec = {
  id: 'gemini-api',
  name: 'Gemini API',
  request: (req, model, key) => {
    const system = systemFor(req)
    const body: Record<string, unknown> = {
      contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    }
    if (system) body['systemInstruction'] = { parts: [{ text: system }] }
    if (req.webSearch) body['tools'] = [{ google_search: {} }]
    else if (req.json) body['generationConfig'] = { responseMimeType: 'application/json' }
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      init: { method: 'POST', headers: { ...JSON_HEADERS, 'x-goog-api-key': key }, body: JSON.stringify(body) },
    }
  },
  parser: () => new GeminiSseParser(),
}

export class GeminiSseParser implements SseParser {
  private text = ''
  private blocked: string | null = null

  event(ev: SseEvent): string {
    const d = json(ev.data)
    if (!d) return ''
    const err = d['error'] as { message?: string } | undefined
    if (err) throw new Error(`Gemini API: ${err.message ?? 'the stream failed.'}`)
    const feedback = d['promptFeedback'] as { blockReason?: string } | undefined
    if (feedback?.blockReason) this.blocked = feedback.blockReason
    const candidates = d['candidates'] as { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] | undefined
    const first = candidates?.[0]
    if (first?.finishReason && /SAFETY|BLOCKLIST|PROHIBITED/.test(first.finishReason)) this.blocked = first.finishReason
    let out = ''
    for (const part of first?.content?.parts ?? []) {
      if (part.thought || typeof part.text !== 'string') continue
      out += part.text
    }
    this.text += out
    return out
  }

  finish(): string {
    if (this.blocked && !this.text.trim()) throw new Error(`Gemini API: the request was blocked (${this.blocked}).`)
    return this.text
  }
}

export const API_SPECS: Record<ApiSpec['id'], ApiSpec> = {
  'anthropic-api': anthropicApi,
  'openai-api': openaiApi,
  'gemini-api': geminiApi,
}

/** Reads a non-2xx response into one readable line, never echoing the key. */
export async function httpError(name: string, res: Response): Promise<Error> {
  let detail = ''
  try {
    const body = await res.text()
    const parsed = json(body) as { error?: { message?: string } | string; message?: string } | null
    const e = parsed?.error
    detail = (typeof e === 'string' ? e : e?.message) ?? parsed?.message ?? body.slice(0, 200)
  } catch {
    // no body
  }
  const hint =
    res.status === 401 || res.status === 403
      ? ' Check the key in Settings > AI connections.'
      : res.status === 404
        ? ' Check the model name.'
        : res.status === 429
          ? ' The provider is rate limiting or the account is out of credit.'
          : ''
  return new Error(`${name}: ${res.status} ${detail || res.statusText}`.trim() + (hint && !detail.includes(hint.trim()) ? hint : ''))
}

/** Streams one request and feeds events to the provider's parser. */
export async function runApi(
  spec: ApiSpec,
  req: AiRequest,
  model: string,
  key: string,
  opts: { onDelta?: (d: string) => void; signal: AbortSignal; fetchFn?: typeof fetch },
): Promise<string> {
  const { url, init } = spec.request(req, model, key)
  const res = await (opts.fetchFn ?? fetch)(url, { ...init, signal: opts.signal })
  if (!res.ok) throw await httpError(spec.name, res)
  if (!res.body) throw new Error(`${spec.name}: the response had no body.`)
  const parser = spec.parser()
  const decoder = new SseDecoder()
  const text = new TextDecoder()
  const reader = res.body.getReader()
  const handle = (events: SseEvent[]) => {
    for (const ev of events) {
      const delta = parser.event(ev)
      if (delta) opts.onDelta?.(delta)
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      handle(decoder.push(text.decode(value, { stream: true })))
    }
    handle(decoder.push(text.decode()))
    handle(decoder.flush())
  } finally {
    reader.releaseLock()
  }
  return parser.finish()
}
