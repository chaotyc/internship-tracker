const DAY = 86_400_000

function parseDay(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const d = new Date(iso.slice(0, 10) + 'T12:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole days from today to an ISO date; negative when past. */
export function daysUntil(iso: string, now = new Date()): number | null {
  const d = parseDay(iso)
  if (!d) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  return Math.round((d.getTime() - today.getTime()) / DAY)
}

/** One colour rule for deadlines everywhere: red within 3 days or passed, amber within 10, plain after. */
export function deadlineTone(iso: string): '' | 'danger' | 'warn' {
  const d = daysUntil(iso)
  if (d == null) return ''
  return d <= 3 ? 'danger' : d <= 10 ? 'warn' : ''
}

export function shortDate(iso: string): string {
  const d = parseDay(iso)
  if (!d) return iso
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "today", "yesterday", "5d ago", "3w ago", or a date. Same wording as since() for days. */
export function ago(iso: string): string {
  const n = daysUntil(iso)
  if (n == null) return iso
  const past = -n
  if (past <= 0) return 'today'
  if (past === 1) return 'yesterday'
  if (past < 14) return `${past}d ago`
  if (past < 60) return `${Math.round(past / 7)}w ago`
  return shortDate(iso)
}

/**
 * Stable hue for a company's monogram: teal to blue only, so a company badge never
 * looks like an urgency signal (amber, red) or the Interviewing stage (violet).
 */
const MONO_HUES = [165, 180, 195, 210, 225]

export function hueFor(name: string): number {
  let h = 0
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 997
  return MONO_HUES[h % MONO_HUES.length]!
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function monogram(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * The one date rule for the whole app: "today 2pm", "tomorrow", a weekday under a
 * week away ("Thu"), otherwise "Nov 30"; past dates read "3 days overdue".
 */
export function dueLabel(due: string, time: string): string {
  const d = daysUntil(due)
  if (d == null) return due
  const t = time ? ` ${formatTime(time)}` : ''
  if (d < 0) return d === -1 ? 'overdue since yesterday' : `${-d} days overdue`
  if (d === 0) return `today${t}`
  if (d === 1) return `tomorrow${t}`
  if (d < 7) return `${new Date(due + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}${t}`
  return `${shortDate(due)}${t}`
}

function formatTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: m ? '2-digit' : undefined }).replace(':00', '').toLowerCase().replace(' ', '')
}

/** Relative time for a timestamp: "just now", "5m ago", "2h ago", then the same day wording as ago(). */
export function since(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((now - t) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = new Date(t)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return ago(day)
}
