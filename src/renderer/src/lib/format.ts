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

export function shortDate(iso: string): string {
  const d = parseDay(iso)
  if (!d) return iso
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "today", "yesterday", "5d ago", "3w ago", or a date. */
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

/** Stable hue for a company's monogram. */
export function hueFor(name: string): number {
  let h = 0
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
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
