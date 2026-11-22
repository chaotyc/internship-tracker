import { describe, expect, it } from 'vitest'
import {
  AnthropicSseParser,
  GeminiSseParser,
  OpenAiSseParser,
  SseDecoder,
  anthropicApi,
  geminiApi,
  openaiApi,
  runApi,
  type SseParser,
} from './api-providers'

function run(parser: SseParser, raw: string): string {
  const dec = new SseDecoder()
  let out = ''
  // Feed in awkward 7-byte chunks to exercise partial lines.
  for (let i = 0; i < raw.length; i += 7) for (const ev of dec.push(raw.slice(i, i + 7))) out += parser.event(ev)
  for (const ev of dec.flush()) out += parser.event(ev)
  return out
}

describe('SseDecoder', () => {
  it('joins multi-line data, skips comments and handles CRLF', () => {
    const dec = new SseDecoder()
    const evs = dec.push(': ping\r\nevent: a\r\ndata: one\r\ndata: two\r\n\r\ndata: {"x":1}\n\n')
    expect(evs).toEqual([
      { event: 'a', data: 'one\ntwo' },
      { event: 'message', data: '{"x":1}' },
    ])
    expect(dec.push('data: tail')).toEqual([])
    expect(dec.flush()).toEqual([{ event: 'message', data: 'tail' }])
  })
})

// Anthropic Messages API stream (documented shape).
const ANTHROPIC = `event: message_start
data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-opus-5-5","stop_reason":null,"usage":{"input_tokens":12,"output_tokens":1}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: ping
data: {"type": "ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}

event: message_stop
data: {"type":"message_stop"}

`

describe('Anthropic Messages stream', () => {
  it('collects text deltas', () => {
    const p = new AnthropicSseParser()
    expect(run(p, ANTHROPIC)).toBe('Hello world')
    expect(p.finish()).toBe('Hello world')
  })

  it('throws on error events and refusals', () => {
    expect(() => run(new AnthropicSseParser(), 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n')).toThrow('Claude API: Overloaded')
    const p = new AnthropicSseParser()
    run(p, 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n')
    expect(() => p.finish()).toThrow(/declined/)
  })

  it('builds a streaming request with the key header and optional web search', () => {
    const { url, init } = anthropicApi.request({ system: 'S', messages: [{ role: 'user', content: 'Hi' }], webSearch: true }, 'claude-opus-5-5', 'sk-test')
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-test')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: 'claude-opus-5-5', stream: true, system: 'S', messages: [{ role: 'user', content: 'Hi' }] })
    expect(body.tools[0].name).toBe('web_search')
    expect(body.temperature).toBeUndefined()
  })
})

// OpenAI Responses API stream (documented event types).
const OPENAI = `event: response.created
data: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","content":[]}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"Hi"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":" there"}

event: response.output_text.done
data: {"type":"response.output_text.done","item_id":"msg_1","text":"Hi there"}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}

`

describe('OpenAI Responses stream', () => {
  it('collects output_text deltas', () => {
    const p = new OpenAiSseParser()
    expect(run(p, OPENAI)).toBe('Hi there')
    expect(p.finish()).toBe('Hi there')
  })

  it('throws on failed responses and error events', () => {
    expect(() => run(new OpenAiSseParser(), 'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"Something broke"}}}\n\n')).toThrow('OpenAI API: Something broke')
    expect(() => run(new OpenAiSseParser(), 'event: error\ndata: {"type":"error","code":"rate_limit_exceeded","message":"Slow down"}\n\n')).toThrow('OpenAI API: Slow down')
  })

  it('builds a request with instructions and the web_search tool', () => {
    const { url, init } = openaiApi.request({ system: 'S', messages: [{ role: 'user', content: 'Hi' }], webSearch: true }, 'gpt-x', 'sk-o')
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-o')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'gpt-x', stream: true, instructions: 'S', tools: [{ type: 'web_search' }] })
  })
})

// Gemini streamGenerateContent?alt=sse (documented chunk shape).
const GEMINI = `data: {"candidates": [{"content": {"parts": [{"text": "Bonjour"}],"role": "model"},"index": 0}],"usageMetadata": {"promptTokenCount": 4},"modelVersion": "gemini-3.8-flash"}

data: {"candidates": [{"content": {"parts": [{"text": "thinking...", "thought": true}, {"text": " le monde"}],"role": "model"},"finishReason": "STOP","index": 0}]}

`

describe('Gemini stream', () => {
  it('collects text parts and skips thoughts', () => {
    const p = new GeminiSseParser()
    expect(run(p, GEMINI)).toBe('Bonjour le monde')
    expect(p.finish()).toBe('Bonjour le monde')
  })

  it('reports blocked prompts and error chunks', () => {
    const p = new GeminiSseParser()
    run(p, 'data: {"promptFeedback": {"blockReason": "SAFETY"}}\n\n')
    expect(() => p.finish()).toThrow(/blocked \(SAFETY\)/)
    expect(() => run(new GeminiSseParser(), 'data: {"error": {"code": 400, "message": "API key not valid"}}\n\n')).toThrow('Gemini API: API key not valid')
  })

  it('maps roles, asks for JSON when no tools are used, and sends the key as a header', () => {
    const { url, init } = geminiApi.request(
      { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], json: true },
      'gemini-3.8-flash',
      'g-key',
    )
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
    expect(url).not.toContain('g-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key')
    const body = JSON.parse(init.body as string)
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model'])
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' })
    expect(body.systemInstruction.parts[0].text).toMatch(/JSON/)
  })
})

describe('runApi', () => {
  const sse = (body: string) => new Response(new Blob([body]).stream(), { status: 200, headers: { 'content-type': 'text/event-stream' } })

  it('streams deltas through onDelta', async () => {
    const deltas: string[] = []
    const fetchFn = (async () => sse(ANTHROPIC)) as unknown as typeof fetch
    const text = await runApi(anthropicApi, { messages: [{ role: 'user', content: 'Hi' }] }, 'm', 'k', { onDelta: (d) => deltas.push(d), signal: new AbortController().signal, fetchFn })
    expect(text).toBe('Hello world')
    expect(deltas).toEqual(['Hello', ' world'])
  })

  it('turns HTTP errors into a readable message with a next step', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 })) as unknown as typeof fetch
    await expect(runApi(anthropicApi, { messages: [{ role: 'user', content: 'Hi' }] }, 'm', 'k', { signal: new AbortController().signal, fetchFn })).rejects.toThrow(
      'Claude API: 401 invalid x-api-key Check the key in Settings > AI connections.',
    )
  })
})
