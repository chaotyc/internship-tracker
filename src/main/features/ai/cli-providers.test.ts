import { describe, expect, it } from 'vitest'
import { CLAUDE_WEB_TOOLS, ClaudeStreamParser, CodexStreamParser, GeminiStreamParser, claudeCli, codexCli, friendlyCliError, geminiCli } from './cli-providers'
import type { StreamParser } from './cli-providers'

function feed(parser: StreamParser, lines: string[]): string {
  return lines.map((l) => parser.line(l)).join('')
}

// Captured from `claude -p --output-format stream-json --verbose --include-partial-messages` (2.1.327), trimmed.
const CLAUDE_PLAIN = [
  '{"type":"system","subtype":"init","cwd":"/tmp/x","session_id":"s1","tools":[],"mcp_servers":[],"model":"claude-haiku-5-5","permissionMode":"default"}',
  '{"type":"system","subtype":"status","status":"requesting","session_id":"s1"}',
  '{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-haiku-5-5","id":"msg_1","type":"message","role":"assistant","content":[]}},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello there"}},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", friend!"}},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"assistant","message":{"model":"claude-haiku-5-5","id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"Hello there, friend!"}]},"parent_tool_use_id":null,"session_id":"s1"}',
  '{"type":"stream_event","event":{"type":"content_block_stop","index":0},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"}},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"message_stop"},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"result":"Hello there, friend!","stop_reason":"end_turn","session_id":"s1"}',
]

// Captured with --tools WebSearch,WebFetch: a tool call, a thinking block, then the answer.
const CLAUDE_WEB = [
  '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"WebSearch","input":{}}},"session_id":"s2","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\": \\"current"}},"session_id":"s2","parent_tool_use_id":null}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"WebSearch","input":{"query":"current Node.js LTS"}}]},"parent_tool_use_id":null,"session_id":"s2"}',
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"..."}]},"parent_tool_use_id":null,"session_id":"s2"}',
  '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}},"session_id":"s2","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"","estimated_tokens":50}},"session_id":"s2","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}},"session_id":"s2","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"26"}},"session_id":"s2","parent_tool_use_id":null}',
  '{"type":"result","subtype":"success","is_error":false,"num_turns":2,"result":"26","session_id":"s2","permission_denials":[]}',
]

describe('Claude Code stream', () => {
  it('streams text deltas and returns the final result', () => {
    const p = new ClaudeStreamParser()
    expect(feed(p, CLAUDE_PLAIN)).toBe('Hello there, friend!')
    expect(p.finish(0, '')).toBe('Hello there, friend!')
  })

  it('ignores tool calls, thinking and non-JSON lines', () => {
    const p = new ClaudeStreamParser()
    expect(feed(p, ['Warning: something odd', '', ...CLAUDE_WEB])).toBe('26')
    expect(p.finish(0, '')).toBe('26')
  })

  it('separates text from consecutive turns', () => {
    const p = new ClaudeStreamParser()
    const start = '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"parent_tool_use_id":null}'
    const delta = (t: string) => JSON.stringify({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } })
    expect(feed(p, [start, delta('Searching.'), start, delta('Found it.')])).toBe('Searching.\n\nFound it.')
  })

  it('skips sub-agent text', () => {
    const p = new ClaudeStreamParser()
    const line = JSON.stringify({ type: 'stream_event', parent_tool_use_id: 'toolu_9', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'inner' } } })
    expect(p.line(line)).toBe('')
  })

  it('surfaces errors with a sign-in hint', () => {
    const p = new ClaudeStreamParser()
    p.line('{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}')
    expect(() => p.finish(1, '')).toThrow(/Claude Code: Not logged in.*sign in/)
    const q = new ClaudeStreamParser()
    expect(() => q.finish(2, 'error: unknown option --foo\n')).toThrow('Claude Code: error: unknown option --foo')
  })

  it('never offers file or shell tools, and web tools only on request', () => {
    const plain = claudeCli.args({ messages: [] }, '', '/tmp/run')
    expect(plain[plain.indexOf('--tools') + 1]).toBe('')
    expect(plain).not.toContain('--allowedTools')
    expect(plain).not.toContain('--model')
    expect(plain).toContain('--no-session-persistence')
    expect(plain.join(' ')).not.toMatch(/Bash|Edit|Write|dangerously|bypassPermissions/)
    expect(plain[plain.indexOf('--system-prompt-file') + 1]).toBe('/tmp/run/system-prompt.md')

    const web = claudeCli.args({ messages: [], webSearch: true }, 'sonnet', '/tmp/run')
    expect(web[web.indexOf('--tools') + 1]).toBe(CLAUDE_WEB_TOOLS)
    expect(web[web.indexOf('--allowedTools') + 1]).toBe('WebSearch,WebFetch')
    expect(web.slice(-2)).toEqual(['--model', 'sonnet'])
  })
})

// Captured from `codex exec --json` (codex-cli 0.169.0).
const CODEX = [
  '{"type":"thread.started","thread_id":"01a20161-13dd-7840-ad0d-2d2f0a9782a2"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello, dear friend!"}}',
  '{"type":"turn.completed","usage":{"input_tokens":16750,"cached_input_tokens":13440,"output_tokens":33}}',
]

describe('Codex stream', () => {
  it('returns the agent message', () => {
    const p = new CodexStreamParser()
    expect(feed(p, CODEX)).toBe('Hello, dear friend!')
    expect(p.finish(0, '')).toBe('Hello, dear friend!')
  })

  it('uses the last agent message as the answer and skips reasoning and commands', () => {
    const p = new CodexStreamParser()
    const streamed = feed(p, [
      '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"thinking"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Let me check."}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"web_search","query":"x"}}',
      '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"42"}}',
    ])
    expect(streamed).toBe('Let me check.\n\n42')
    expect(p.finish(0, '')).toBe('42')
  })

  it('reports failures', () => {
    const p = new CodexStreamParser()
    feed(p, ['{"type":"error","message":"stream disconnected"}', '{"type":"turn.failed","error":{"message":"401 Unauthorized"}}'])
    expect(() => p.finish(1, '')).toThrow(/Codex: 401 Unauthorized.*sign in/)
  })

  it('runs read-only in the temp dir with no git check, web search only on request', () => {
    const a = codexCli.args({ messages: [] }, '', '/tmp/run')
    expect(a.slice(0, 2)).toEqual(['exec', '--json'])
    expect(a[a.indexOf('--sandbox') + 1]).toBe('read-only')
    expect(a[a.indexOf('--cd') + 1]).toBe('/tmp/run')
    expect(a).toContain('--skip-git-repo-check')
    expect(a.at(-1)).toBe('-')
    expect(a.join(' ')).not.toMatch(/dangerously|workspace-write|full-access/)
    expect(codexCli.args({ messages: [], webSearch: true }, 'gpt-x', '/tmp/run').slice(0, 2)).toEqual(['--search', 'exec'])
    expect(codexCli.stdin({ system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }] })).toBe('<instructions>\nBe brief.\n</instructions>\n\nHi')
  })
})

// Gemini CLI isn't installed here; these lines follow the documented stream-json event types.
const GEMINI = [
  '{"type":"init","timestamp":"2026-11-21T10:00:00.000Z","session_id":"g1","model":"gemini-3.8-flash"}',
  '{"type":"message","timestamp":"2026-11-21T10:00:00.100Z","role":"user","content":"Say hello"}',
  '{"type":"message","timestamp":"2026-11-21T10:00:01.000Z","role":"assistant","content":"Hello","delta":true}',
  '{"type":"tool_use","timestamp":"2026-11-21T10:00:01.100Z","tool_name":"google_web_search","tool_id":"t1","parameters":{"query":"x"}}',
  '{"type":"tool_result","timestamp":"2026-11-21T10:00:01.500Z","tool_id":"t1","status":"success","output":"..."}',
  '{"type":"message","timestamp":"2026-11-21T10:00:02.000Z","role":"assistant","content":" there!","delta":true}',
  '{"type":"result","timestamp":"2026-11-21T10:00:02.100Z","status":"success","stats":{"total_tokens":12}}',
]

describe('Gemini CLI stream', () => {
  it('streams assistant messages and skips the echoed prompt and tools', () => {
    const p = new GeminiStreamParser()
    expect(feed(p, GEMINI)).toBe('Hello there!')
    expect(p.finish(0, '')).toBe('Hello there!')
  })

  it('treats warnings as non-fatal and errors as failures', () => {
    const p = new GeminiStreamParser()
    feed(p, ['{"type":"error","severity":"warning","message":"slow"}', '{"type":"result","status":"error","error":{"type":"auth","message":"Please sign in"}}'])
    expect(() => p.finish(1, '')).toThrow(/Gemini CLI: Please sign in/)
  })

  it('asks for stream-json and passes the model', () => {
    expect(geminiCli.args({ messages: [] }, 'gemini-x', '/tmp/run')).toEqual(['--output-format', 'stream-json', '--approval-mode', 'default', '--model', 'gemini-x'])
  })
})

describe('friendlyCliError', () => {
  it('adds a sign-in step only for auth problems', () => {
    expect(friendlyCliError('Invalid API key')).toMatch(/run the CLI once to sign in/)
    expect(friendlyCliError('Rate limit reached, unauthorized burst')).not.toMatch(/sign in/)
    expect(friendlyCliError('model not found')).toBe('model not found')
  })
})
