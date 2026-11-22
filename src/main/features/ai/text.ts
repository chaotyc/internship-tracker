import type { AiMessage, AiRequest } from '@shared/ai'

/** Appended to the system prompt when a caller wants JSON back. */
export const JSON_INSTRUCTION =
  'Reply with one JSON value only: no prose before or after it and no code fences.'

/** System prompt with the JSON instruction added when asked for. */
export function systemFor(req: AiRequest): string {
  const base = req.system?.trim() ?? ''
  if (!req.json) return base
  return base ? `${base}\n\n${JSON_INSTRUCTION}` : JSON_INSTRUCTION
}

/**
 * Flattens a conversation into one prompt for CLIs that take a single message.
 * A lone user message is passed through as-is.
 */
export function transcript(messages: AiMessage[]): string {
  if (messages.length === 1 && messages[0]!.role === 'user') return messages[0]!.content
  const turns = messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n\n')
  return `Here is the conversation so far. Write the assistant's next reply to the last user message.\n\n${turns}`
}

/**
 * Pulls one JSON value out of a model reply. Accepts, in order: the whole reply,
 * a ```json fenced block, or the span from the first { or [ to the last } or ].
 */
export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim()
  const attempts: string[] = [trimmed]
  for (const m of trimmed.matchAll(/```(?:json|JSON)?[ \t]*\r?\n?([\s\S]*?)```/g)) attempts.push(m[1]!.trim())
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = trimmed.indexOf(open)
    const end = trimmed.lastIndexOf(close)
    if (start !== -1 && end > start) attempts.push(trimmed.slice(start, end + 1))
  }
  // Prefer the outermost value: try the span that starts earliest first.
  const spans = attempts.slice(1).sort((a, b) => trimmed.indexOf(a) - trimmed.indexOf(b))
  for (const candidate of [attempts[0]!, ...spans]) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate) as T
    } catch {
      // try the next shape
    }
  }
  const preview = trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed
  throw new Error(
    trimmed ? `The AI reply wasn't valid JSON. It started: "${preview}"` : 'The AI sent an empty reply where JSON was expected.',
  )
}

/** Splits a byte/text stream into lines, keeping a partial last line until more arrives. */
export class LineSplitter {
  private buf = ''
  push(chunk: string): string[] {
    this.buf += chunk
    const parts = this.buf.split(/\r?\n/)
    this.buf = parts.pop() ?? ''
    return parts
  }
  flush(): string[] {
    const rest = this.buf
    this.buf = ''
    return rest ? [rest] : []
  }
}

/** Parses a line as JSON, or returns null for blank or non-JSON lines (CLIs print the odd warning). */
export function parseJsonLine(line: string): Record<string, unknown> | null {
  const t = line.trim()
  if (!t.startsWith('{')) return null
  try {
    const v = JSON.parse(t)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
