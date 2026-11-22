import { join } from 'node:path'
import type { AiRequest, ProviderId } from '@shared/ai'
import { parseJsonLine, systemFor, transcript } from './text'

/**
 * How to call each CLI and read its streamed output. Pure functions of the request,
 * so they can be tested against captured output without running anything.
 */
export interface CliSpec {
  id: Extract<ProviderId, 'claude-cli' | 'codex-cli' | 'gemini-cli'>
  bin: string
  /** Display name used in "Claude Code 2.1.3". */
  name: string
  /** Files the run needs in its empty temp dir, keyed by name. */
  files?: (req: AiRequest) => Record<string, string>
  args: (req: AiRequest, model: string, dir: string) => string[]
  stdin: (req: AiRequest) => string
  parser: () => StreamParser
}

export interface StreamParser {
  /** Feeds one stdout line; returns any new text to show. */
  line(line: string): string
  /** Final reply text. Throws with a readable message if the CLI reported a failure. */
  finish(exitCode: number | null, stderr: string): string
}

const DEFAULT_SYSTEM = 'You are a helpful assistant inside Internship Tracker, a desktop app for tracking job applications.'
const SYSTEM_FILE = 'system-prompt.md'

/* ---------------------------------- Claude Code ---------------------------------- */

/** Built-in web tools are the only ones Claude Code may use; file and shell tools are never offered. */
export const CLAUDE_WEB_TOOLS = 'WebSearch,WebFetch'

export const claudeCli: CliSpec = {
  id: 'claude-cli',
  bin: 'claude',
  name: 'Claude Code',
  files: (req) => ({ [SYSTEM_FILE]: systemFor(req) || DEFAULT_SYSTEM }),
  args: (req, model, dir) => [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode',
    'dontAsk',
    '--tools',
    req.webSearch ? CLAUDE_WEB_TOOLS : '',
    ...(req.webSearch ? ['--allowedTools', CLAUDE_WEB_TOOLS] : []),
    '--system-prompt-file',
    join(dir, SYSTEM_FILE),
    ...(model ? ['--model', model] : []),
  ],
  stdin: (req) => transcript(req.messages),
  parser: () => new ClaudeStreamParser(),
}

/** Reads `claude -p --output-format stream-json --include-partial-messages`. */
export class ClaudeStreamParser implements StreamParser {
  private text = ''
  private result: string | null = null
  private error: string | null = null
  private blockHasText = false

  line(line: string): string {
    const ev = parseJsonLine(line)
    if (!ev) return ''
    // Text from sub-agents (parent_tool_use_id set) is not part of the reply.
    if (ev['type'] === 'stream_event' && !ev['parent_tool_use_id']) {
      const e = ev['event'] as Record<string, unknown> | undefined
      if (e?.['type'] === 'content_block_start') {
        const block = e['content_block'] as { type?: string } | undefined
        this.blockHasText = block?.type === 'text'
        // Separate text from earlier turns (e.g. "Searching…" then the answer).
        if (this.blockHasText && this.text && !this.text.endsWith('\n')) {
          this.text += '\n\n'
          return '\n\n'
        }
        return ''
      }
      if (e?.['type'] === 'content_block_delta') {
        const d = e['delta'] as { type?: string; text?: string } | undefined
        if (d?.type === 'text_delta' && d.text) {
          this.text += d.text
          return d.text
        }
      }
      return ''
    }
    if (ev['type'] === 'result') {
      if (ev['is_error'] || (typeof ev['subtype'] === 'string' && ev['subtype'] !== 'success')) {
        this.error = typeof ev['result'] === 'string' && ev['result'] ? ev['result'] : String(ev['subtype'] ?? 'error')
      } else if (typeof ev['result'] === 'string') {
        this.result = ev['result']
      }
    }
    return ''
  }

  finish(exitCode: number | null, stderr: string): string {
    if (this.error) throw new Error(`Claude Code: ${friendlyCliError(this.error)}`)
    const text = this.result ?? this.text
    if (exitCode !== 0 && !text) throw new Error(`Claude Code: ${friendlyCliError(lastLines(stderr) || `exited with code ${exitCode}`)}`)
    return text
  }
}

/* ------------------------------------- Codex ------------------------------------- */

export const codexCli: CliSpec = {
  id: 'codex-cli',
  bin: 'codex',
  name: 'Codex',
  args: (req, model, dir) => [
    ...(req.webSearch ? ['--search'] : []),
    'exec',
    '--json',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color',
    'never',
    '--cd',
    dir,
    ...(model ? ['--model', model] : []),
    '-',
  ],
  // Codex has no system-prompt flag, so instructions lead the prompt.
  stdin: (req) => {
    const system = systemFor(req)
    const body = transcript(req.messages)
    return system ? `<instructions>\n${system}\n</instructions>\n\n${body}` : body
  },
  parser: () => new CodexStreamParser(),
}

/** Reads `codex exec --json` JSONL: whole agent messages arrive as item.completed events. */
export class CodexStreamParser implements StreamParser {
  private messages: string[] = []
  private error: string | null = null

  line(line: string): string {
    const ev = parseJsonLine(line)
    if (!ev) return ''
    const type = ev['type']
    if (type === 'item.completed') {
      const item = ev['item'] as { type?: string; text?: string } | undefined
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        const sep = this.messages.length ? '\n\n' : ''
        this.messages.push(item.text)
        return sep + item.text
      }
    } else if (type === 'turn.failed') {
      const err = ev['error'] as { message?: string } | undefined
      this.error = err?.message ?? 'The turn failed.'
    } else if (type === 'error' && typeof ev['message'] === 'string') {
      this.error = ev['message']
    }
    return ''
  }

  finish(exitCode: number | null, stderr: string): string {
    // The last agent message is the answer; earlier ones are progress notes.
    const text = this.messages.at(-1) ?? ''
    if (this.error && !text) throw new Error(`Codex: ${friendlyCliError(this.error)}`)
    if (exitCode !== 0 && !text) throw new Error(`Codex: ${friendlyCliError(lastLines(stderr) || `exited with code ${exitCode}`)}`)
    return text
  }
}

/* ----------------------------------- Gemini CLI ---------------------------------- */

export const geminiCli: CliSpec = {
  id: 'gemini-cli',
  bin: 'gemini',
  name: 'Gemini CLI',
  // Headless mode starts on its own when stdin isn't a terminal; the prompt comes on stdin.
  // The default approval mode never runs tools that need confirmation (edits, shell) without a person.
  args: (_req, model) => ['--output-format', 'stream-json', '--approval-mode', 'default', ...(model ? ['--model', model] : [])],
  stdin: (req) => {
    const system = systemFor(req)
    const body = transcript(req.messages)
    return system ? `<instructions>\n${system}\n</instructions>\n\n${body}` : body
  },
  parser: () => new GeminiStreamParser(),
}

/** Reads `gemini --output-format stream-json`: assistant `message` events carry text, `result` ends the run. */
export class GeminiStreamParser implements StreamParser {
  private text = ''
  private error: string | null = null

  line(line: string): string {
    const ev = parseJsonLine(line)
    if (!ev) return ''
    if (ev['type'] === 'message' && ev['role'] === 'assistant' && typeof ev['content'] === 'string') {
      this.text += ev['content']
      return ev['content']
    }
    if (ev['type'] === 'error' && ev['severity'] !== 'warning') {
      this.error = typeof ev['message'] === 'string' ? ev['message'] : 'Gemini CLI reported an error.'
    }
    if (ev['type'] === 'result' && ev['status'] === 'error') {
      const err = ev['error'] as { message?: string } | undefined
      this.error = err?.message ?? this.error ?? 'Gemini CLI reported an error.'
    }
    return ''
  }

  finish(exitCode: number | null, stderr: string): string {
    if (this.error && !this.text) throw new Error(`Gemini CLI: ${friendlyCliError(this.error)}`)
    if (exitCode !== 0 && !this.text) throw new Error(`Gemini CLI: ${friendlyCliError(lastLines(stderr) || `exited with code ${exitCode}`)}`)
    return this.text
  }
}

export const CLI_SPECS: Record<CliSpec['id'], CliSpec> = {
  'claude-cli': claudeCli,
  'codex-cli': codexCli,
  'gemini-cli': geminiCli,
}

/* ------------------------------------ helpers ------------------------------------ */

function lastLines(s: string, n = 3): string {
  return s.trim().split(/\r?\n/).filter(Boolean).slice(-n).join(' ').slice(0, 400)
}

/** Turns common CLI failures into a next step the user can take. */
export function friendlyCliError(msg: string): string {
  const m = msg.trim()
  if (/not logged in|log ?in|sign ?in|authenticat|unauthori[sz]ed|\b401\b|api key/i.test(m) && !/rate/i.test(m)) {
    return `${m.replace(/\.$/, '')}. Open a terminal and run the CLI once to sign in.`
  }
  return m
}
