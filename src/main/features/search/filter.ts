/** Deciding which board postings are worth suggesting, and ranking them when no AI is connected. */
import type { SearchPreferences } from '@shared/profile'
import type { JobPosting } from './boards'

const INTERN_RE = /\b(intern|interns|internship|internships|co-?op|werkstudent|student researcher|student (?:engineer|program)|residency|fellows|fellowship|apprentice(?:ship)?|summer (?:analyst|associate|student))\b/i
const STAFF_RE = /\b(recruit(?:er|ing)|coordinator|program manager|senior|staff|principal|lead|manager|director|sr\.?)\b/i

/** "Intern", "Co-op", "Fellowship", ... in the title, or an intern/university department, and not a staff role about interns. */
export function isInternshipLike(p: Pick<JobPosting, 'title' | 'department'>): boolean {
  if (INTERN_RE.test(p.title)) return !/\b(recruit(?:er|ing)|coordinator|program manager)\b/i.test(p.title)
  // Some boards put interns in a department and leave "intern" out of the title.
  return /\b(intern|interns|internships?|university|early careers?|students?)\b/i.test(p.department) && !STAFF_RE.test(p.title)
}

const SEASONS = ['spring', 'summer', 'fall', 'autumn', 'winter'] as const
const seasonOf = (s: string) => SEASONS.filter((x) => new RegExp(`\\b${x}\\b`, 'i').test(s)).map((x) => (x === 'autumn' ? 'fall' : x))
const yearsOf = (s: string) => [...s.matchAll(/\b(20\d\d)\b/g)].map((m) => m[1]!)

/** False only when the title names a different year or season than the term the user wants. */
export function matchesTerm(title: string, term: string): boolean {
  if (!term.trim()) return true
  const ty = yearsOf(term)
  const py = yearsOf(title)
  if (ty.length && py.length && !py.some((y) => ty.includes(y))) return false
  const ts = seasonOf(term)
  const ps = seasonOf(title)
  if (ts.length && ps.length && !ps.some((s) => ts.includes(s))) return false
  return true
}

const BAY_AREA = ['san francisco', 'south san francisco', 'oakland', 'berkeley', 'san jose', 'santa clara', 'sunnyvale', 'mountain view', 'palo alto', 'menlo park', 'redwood city', 'san mateo', 'cupertino', 'milpitas', 'fremont', 'foster city', 'emeryville', 'san carlos', 'burlingame', 'los gatos', 'bay area']
const ALIASES: Record<string, string[]> = {
  'bay area': BAY_AREA,
  'sf bay area': BAY_AREA,
  'san francisco bay area': BAY_AREA,
  sf: ['san francisco'],
  nyc: ['new york', 'nyc', 'brooklyn'],
  'new york city': ['new york', 'nyc'],
  la: ['los angeles'],
  seattle: ['seattle', 'bellevue', 'redmond', 'kirkland'],
  boston: ['boston', 'cambridge'],
}

function locationNeedles(pref: string): string[] {
  const p = pref.trim().toLowerCase()
  if (!p) return []
  if (ALIASES[p]) return ALIASES[p]
  // "San Francisco, CA" → "san francisco"
  const city = p.split(',')[0]!.trim()
  return [city]
}

export function matchesLocation(location: string, prefs: Pick<SearchPreferences, 'locations' | 'remoteOk'>): boolean {
  const wanted = prefs.locations.map((l) => l.trim()).filter(Boolean)
  const loc = location.toLowerCase()
  if (!wanted.length || !loc.trim()) return true
  const remote = /\bremote\b/.test(loc)
  if (remote && (prefs.remoteOk || wanted.some((w) => /\bremote\b/i.test(w)))) return true
  return wanted.some((w) => locationNeedles(w).some((n) => n && n !== 'remote' && loc.includes(n)))
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wordRe(k: string): RegExp {
  const e = escapeRe(k.trim())
  // Word boundaries only where the keyword starts/ends with a word character ("C++" has none at the end).
  return new RegExp(`${/^\w/.test(k) ? '\\b' : ''}${e}${/\w$/.test(k) ? '\\b' : ''}`, 'i')
}

const STOP = new Set(['intern', 'interns', 'internship', 'engineer', 'engineering', 'software', 'and', 'the', 'for', 'of', 'in', 'a', 'an', 'role', 'roles', 'summer', 'student', 'research', 'researcher'])

/** Keywords the user cares about: their keywords plus the meaningful words of their target roles. */
export function wantedKeywords(prefs: Pick<SearchPreferences, 'keywords' | 'targetRoles'>): string[] {
  const out = new Map<string, string>()
  for (const k of prefs.keywords) if (k.trim()) out.set(k.trim().toLowerCase(), k.trim())
  for (const r of prefs.targetRoles)
    for (const w of r.split(/[\s,/]+/)) {
      const t = w.trim()
      if (t.length >= 2 && !STOP.has(t.toLowerCase()) && !/^20\d\d$/.test(t)) out.set(t.toLowerCase(), t)
    }
  return [...out.values()]
}

export function excludedBy(p: Pick<JobPosting, 'title' | 'department'>, exclude: string[]): string {
  const hay = `${p.title}\n${p.department}`
  return exclude.find((k) => k.trim() && wordRe(k).test(hay)) ?? ''
}

export interface FilterResult {
  kept: JobPosting[]
  counts: { total: number; notInternship: number; wrongTerm: number; wrongPlace: number; excluded: number; noKeyword: number }
}

/** Internship-like postings that fit the term, places and keywords, minus excluded words. */
export function filterPostings(postings: JobPosting[], prefs: SearchPreferences): FilterResult {
  const counts = { total: postings.length, notInternship: 0, wrongTerm: 0, wrongPlace: 0, excluded: 0, noKeyword: 0 }
  const kws = wantedKeywords(prefs)
  const kept: JobPosting[] = []
  for (const p of postings) {
    if (!isInternshipLike(p)) counts.notInternship++
    else if (!matchesTerm(p.title, prefs.term)) counts.wrongTerm++
    else if (!matchesLocation(p.location, prefs)) counts.wrongPlace++
    else if (excludedBy(p, prefs.excludeKeywords)) counts.excluded++
    else if (kws.length && !kws.some((k) => wordRe(k).test(`${p.title}\n${p.department}\n${p.description}`))) counts.noKeyword++
    else kept.push(p)
  }
  return { kept, counts }
}

export interface Scored {
  posting: JobPosting
  score: number
  reason: string
}

const DAY = 86_400_000

/**
 * Keywords that show up in most of a company's postings come from its boilerplate ("we build photonic chips"),
 * so they say little about one role. Returns company → those keywords.
 */
export function boilerplateKeywords(postings: JobPosting[], prefs: Pick<SearchPreferences, 'keywords' | 'targetRoles'>): Map<string, Set<string>> {
  const kws = wantedKeywords(prefs)
  const byCompany = new Map<string, JobPosting[]>()
  for (const p of postings) byCompany.set(p.company, [...(byCompany.get(p.company) ?? []), p])
  const out = new Map<string, Set<string>>()
  for (const [company, list] of byCompany) {
    if (list.length < 4) continue
    const common = kws.filter((k) => list.filter((p) => wordRe(k).test(p.description)).length / list.length >= 0.6)
    if (common.length) out.set(company, new Set(common))
  }
  return out
}

/** A 0-100 score from keyword, place, term and recency matches, with a plain reason. Used when no AI is connected. */
export function keywordScore(p: JobPosting, prefs: SearchPreferences, now = Date.now(), boilerplate?: Set<string>): Scored {
  const kws = wantedKeywords(prefs)
  const inTitle = kws.filter((k) => wordRe(k).test(p.title))
  const inBody = kws.filter((k) => !inTitle.includes(k) && !boilerplate?.has(k) && wordRe(k).test(`${p.department}\n${p.description}`))
  let score = 40
  score += Math.min(40, inTitle.length * 24)
  score += Math.min(16, inBody.length * 4)
  const place = prefs.locations.some((l) => l.trim())
    ? p.location.split(/;|\bor\b/).map((x) => x.trim()).find((x) => x && matchesLocation(x, { ...prefs, remoteOk: false }))
    : undefined
  if (place) score += 6
  const termed = prefs.term.trim() && yearsOf(prefs.term).some((y) => p.title.includes(y))
  if (termed) score += 4
  if (p.postedAt) {
    const age = (now - new Date(p.postedAt + 'T12:00:00Z').getTime()) / DAY
    if (age <= 14) score += 4
    else if (age > 120) score -= 6
  }
  score = Math.max(0, Math.min(100, Math.round(score)))

  const bits: string[] = []
  if (inTitle.length) bits.push(`title mentions ${list(inTitle)}`)
  if (inBody.length) bits.push(`${inTitle.length ? 'description also covers' : 'description mentions'} ${list(inBody.slice(0, 4))}`)
  if (place) bits.push(`in ${place}`)
  if (termed) bits.push(`for ${prefs.term.trim()}`)
  const reason = bits.length ? cap(bits.join('; ')) + '.' : 'An internship on a board you follow; no keyword matches.'
  return { posting: p, score, reason }
}

const list = (a: string[]) => (a.length <= 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface RankOptions {
  limit?: number
  /** At most this many per company, so one big board can't fill the list (unless nothing else is left). */
  perCompany?: number
  now?: number
  /** From boilerplateKeywords(). */
  boilerplate?: Map<string, Set<string>>
}

/** Keyword ranking, best first, ties broken by newest. */
export function rankByKeywords(postings: JobPosting[], prefs: SearchPreferences, opts: RankOptions = {}): Scored[] {
  const { limit = 40, perCompany = 8, now = Date.now(), boilerplate } = opts
  const sorted = postings
    .map((p) => keywordScore(p, prefs, now, boilerplate?.get(p.company)))
    .sort((a, b) => b.score - a.score || b.posting.postedAt.localeCompare(a.posting.postedAt))
  const picked: Scored[] = []
  const overflow: Scored[] = []
  const per = new Map<string, number>()
  for (const s of sorted) {
    const n = per.get(s.posting.company) ?? 0
    if (n < perCompany) {
      picked.push(s)
      per.set(s.posting.company, n + 1)
    } else overflow.push(s)
  }
  return [...picked.slice(0, limit), ...overflow].slice(0, limit).sort((a, b) => b.score - a.score || b.posting.postedAt.localeCompare(a.posting.postedAt))
}
