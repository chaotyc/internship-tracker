/** Deciding which board postings are worth suggesting, and ranking them when no AI is connected. */
import type { DegreeLevel, RoleType, SearchPreferences } from '@shared/profile'
import type { SkipReason } from '@shared/search'
import type { JobPosting } from './boards'
import { ineligibleReason } from './eligibility'
import { requirementsExcerpt } from './requirements'

const INTERN_RE = /\b(intern|interns|internship|internships|co-?op|werkstudent|student researcher|student (?:engineer|program)|residency|fellows|fellowship|apprentice(?:ship)?|summer (?:analyst|associate|student))\b/i
const STAFF_RE = /\b(recruit(?:er|ing)|coordinator|program manager|senior|staff|principal|lead|manager|director|sr\.?)\b/i
/**
 * Staff who run intern or new grad hiring: "University Recruiter, Interns", "Internship Program Manager",
 * "Recruiting Coordinator". Not "Recruiting Intern", "Marketing Coordinator Intern" or "Technical Program Manager Intern".
 */
const ABOUT_INTERNS_RE =
  /\brecruiters?\b|\brecruiting (?:coordinator|manager|lead|partner|specialist)\b|\b(?:intern(?:ship)?s?|university|campus|early[- ]careers?|student|new grads?)\s+(?:programs?\s+)?(?:coordinator|manager|lead|specialist|partner)\b|\b(?:program manager|coordinator)\s*(?:,|-|–|\bfor\b|\bof\b)\s*(?:the\s+)?(?:intern(?:ship)?s?|university|campus)\b/i
/**
 * Titles that are never entry level, whatever else they say. "Member of Technical Staff" is a common new grad
 * title at AI labs, so "staff" after "technical" doesn't count; a level range ("Engineer 1/2/3") may start at level 1.
 */
const TRULY_SENIOR_RE = /\b(senior|(?<!technical\s)staff|principal|director|head of|vp|vice president|sr\.?|distinguished|chief)\b|(?<!\/\s*)\b(?:II|III|IV|2|3|4)\s*$/i
/** Words that usually mean an experienced role; an explicit new grad title or list overrides them ("Associate Product Manager, New Grad"). */
const SENIOR_RE = /\b(lead|manager|architect)\b/i
/** An explicit new grad signal in the title: trusted over "manager", "architect" and even "intern" ("New Grad / Intern"). */
const STRONG_NEWGRAD_RE =
  /\b(new[- ]?grad(?:uate)?s?|new college grad(?:uate)?s?|university grad(?:uate)?s?|recent grad(?:uate)?s?|college grad(?:uate)?s?|entry[- ]level|early[- ]career|associate product managers?)\b/i
const NEWGRAD_RE = new RegExp(
  String.raw`${STRONG_NEWGRAD_RE.source}|\b(graduate (?:program|programme|engineer|scheme|software|hardware|talent|rotation(?:al)?)|rotational (?:program|engineer)|junior|associate (?:software|hardware|engineer|data|research|scientist))\b|\b(?:engineer|scientist|developer|analyst)\s+(?:I|1)\b(?!\s*[I\d])`,
  'i',
)
/** A department or list that holds only new grad roles (Halcyon "New Grads", the SimplifyJobs new grad list). */
const NEWGRAD_DEPT_RE = /\bnew[- ]?grad(?:uate)?s?\b/i

/** "Intern", "Co-op", "Fellowship", ... in the title, or an intern/university department, and not a staff role about interns. */
export function isInternshipLike(p: Pick<JobPosting, 'title' | 'department'>): boolean {
  if (INTERN_RE.test(p.title)) return !ABOUT_INTERNS_RE.test(p.title)
  // A university department also holds new grad roles; those aren't internships.
  if (NEWGRAD_RE.test(p.title) || NEWGRAD_DEPT_RE.test(p.department)) return false
  // Some boards put interns in a department and leave "intern" out of the title.
  return /\b(intern|interns|internships?|university|early careers?|students?)\b/i.test(p.department) && !STAFF_RE.test(p.title)
}

/**
 * New grad, university grad and entry-level roles (not internships, not senior). A plain title in a
 * university or early-careers department counts as both this and an internship, since it could be either.
 */
export function isNewGradLike(p: Pick<JobPosting, 'title' | 'department'>): boolean {
  const t = p.title
  // Hiring staff: a "University Recruiter, New Grads" is not a new grad role.
  if (ABOUT_INTERNS_RE.test(t)) return false
  // "Associate Product Manager - New Grad", "Software Engineer, New Grad / Intern 2027", even "Senior … New Grad".
  if (STRONG_NEWGRAD_RE.test(t)) return true
  if (TRULY_SENIOR_RE.test(t)) return false
  if (INTERN_RE.test(t)) return false
  // A new grad department or list vouches for "Product Manager" or "Solutions Architect".
  if (NEWGRAD_DEPT_RE.test(p.department)) return true
  if (SENIOR_RE.test(t)) return false
  return NEWGRAD_RE.test(t) || /\b(university|early careers?|campus|graduates?)\b/i.test(p.department)
}

/** True when the posting is one of the kinds of role the user wants. */
export function matchesRoleType(p: Pick<JobPosting, 'title' | 'department'>, types: RoleType[]): boolean {
  const intern = isInternshipLike(p)
  if (intern && types.includes('internship')) return true
  if (isNewGradLike(p) && (types.includes('newgrad') || types.includes('fulltime'))) return true
  return !intern && types.includes('fulltime')
}

const TYPE_NAMES: Record<RoleType, string> = { internship: 'internships', newgrad: 'new grad roles', fulltime: 'full-time roles' }
const typeList = (types: RoleType[]) => types.map((t) => TYPE_NAMES[t]).join(' or ')

const SEASONS = ['spring', 'summer', 'fall', 'autumn', 'winter'] as const
const seasonOf = (s: string) => SEASONS.filter((x) => new RegExp(`\\b${x}\\b`, 'i').test(s)).map((x) => (x === 'autumn' ? 'fall' : x))
const yearsOf = (s: string) => [...s.matchAll(/\b(20\d\d)\b/g)].map((m) => m[1]!)

/**
 * Whether the posting fits the wanted term. A season ("Summer 2027") is an internship term, so it only rules out
 * internships; a new grad title's year is usually the graduation year ("New Grad - December 2026"). A bare year
 * ("2027") applies to every posting.
 */
export function termFits(p: Pick<JobPosting, 'title' | 'department'>, term: string): boolean {
  if (seasonOf(term).length && !isInternshipLike(p)) return true
  return matchesTerm(p.title, term)
}

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

const BAY_AREA = ['san francisco', 'sf', 'south san francisco', 'oakland', 'berkeley', 'san jose', 'santa clara', 'sunnyvale', 'mountain view', 'palo alto', 'menlo park', 'redwood city', 'san mateo', 'cupertino', 'milpitas', 'fremont', 'foster city', 'emeryville', 'san carlos', 'burlingame', 'los gatos', 'los altos', 'bay area']
const ALIASES: Record<string, string[]> = {
  'bay area': BAY_AREA,
  'sf bay area': BAY_AREA,
  'san francisco bay area': BAY_AREA,
  sf: ['san francisco', 'sf'],
  nyc: ['new york', 'nyc', 'brooklyn'],
  'new york city': ['new york', 'nyc'],
  la: ['los angeles', 'la'],
  seattle: ['seattle', 'bellevue', 'redmond', 'kirkland'],
  boston: ['boston', 'cambridge'],
}
/** Short forms boards use for a city ("SF", "NYC", "LA" on the SimplifyJobs lists). */
const SHORT_FORMS: Record<string, string[]> = { 'san francisco': ['sf'], 'new york': ['nyc'], 'los angeles': ['la'] }

const US_STATES =
  'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york state|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington state|west virginia|wisconsin|wyoming'

function locationNeedles(pref: string): string[] {
  const p = pref.trim().toLowerCase()
  if (!p) return []
  if (ALIASES[p]) return ALIASES[p]
  // "San Francisco, CA" → "san francisco"; "Seattle, WA" → Seattle and its neighbours.
  const city = p.split(',')[0]!.trim()
  const out = ALIASES[city] ?? [city]
  return [...new Set([...out, ...out.flatMap((n) => SHORT_FORMS[n] ?? [])])]
}

const needleCache = new Map<string, RegExp>()
/** Whole words only, so "la" finds "LA" but not "Atlanta", and "sf" finds "South SF". */
function needleRe(n: string): RegExp {
  let re = needleCache.get(n)
  if (!re) {
    re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(n)}(?![a-z0-9])`, 'i')
    needleCache.set(n, re)
  }
  return re
}

/** A location that names no particular city: "2 Locations", "Multiple locations", a whole country or US state, or blank. */
const UNCLEAR_PLACE = new RegExp(
  String.raw`^\s*$|\b\d+\s+locations?\b|\b(?:multiple|various|several|many|all)\s+(?:us\s+)?locations?\b|\bflexible\b|\banywhere\b|^\s*(?:united states(?: of america)?|usa?|u\.s\.a?\.?|north america|americas|canada|global|worldwide|hybrid|(?:${US_STATES})(?:,\s*(?:us|usa|united states))?)\s*(?:\(.*\))?\s*$`,
  'i',
)

/**
 * 'match' when the location names a place the user wants (or remote, when that's fine), 'unclear' when it
 * names no city at all, 'no' otherwise. Unclear ones are kept so the AI (or the user) can judge them.
 */
export function locationFit(location: string, prefs: Pick<SearchPreferences, 'locations' | 'remoteOk'>): 'match' | 'unclear' | 'no' {
  const wanted = prefs.locations.map((l) => l.trim()).filter(Boolean)
  const loc = location.toLowerCase()
  if (!wanted.length) return 'match'
  if (UNCLEAR_PLACE.test(loc)) return 'unclear'
  const remote = /\bremote\b/.test(loc)
  if (remote && (prefs.remoteOk || wanted.some((w) => /\bremote\b/i.test(w)))) return 'match'
  return wanted.some((w) => locationNeedles(w).some((n) => n && n !== 'remote' && needleRe(n).test(loc))) ? 'match' : 'no'
}

/** "San Francisco Bay Area or remote", for the reason a posting was skipped. */
function placesText(prefs: Pick<SearchPreferences, 'locations' | 'remoteOk'>): string {
  const wanted = prefs.locations.map((l) => l.trim()).filter(Boolean)
  if (prefs.remoteOk && !wanted.some((w) => /\bremote\b/i.test(w))) wanted.push('remote')
  return wanted.length <= 2 ? wanted.join(' or ') : `${wanted.slice(0, -1).join(', ')} or ${wanted[wanted.length - 1]}`
}

export function matchesLocation(location: string, prefs: Pick<SearchPreferences, 'locations' | 'remoteOk'>): boolean {
  return locationFit(location, prefs) !== 'no'
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function boundaryRe(body: string, first: string, last: string): string {
  return `${/^\w/.test(first) ? '\\b' : ''}${body}${/\w$/.test(last) ? '\\b' : ''}`
}

/** One phrase with its plural and singular forms ("compiler" ↔ "compilers", "GPU" ↔ "GPUs"), spaces or hyphens between words. */
function phrasePattern(phrase: string): string {
  const k = phrase.trim()
  const words = k.split(/[\s-]+/).filter(Boolean)
  // Only spaces and hyphens ("-", "--"): match it literally, never everything.
  if (!words.length) return escapeRe(k)
  const last = words.pop()!
  const lead = words.map(escapeRe).join('[\\s-]+')
  const join = lead ? `${lead}[\\s-]+` : ''
  let tail = escapeRe(last)
  if (/^engineer(?:ing|s)?$/i.test(last)) tail = 'engineer(?:ing|s)?'
  else if (/[a-z]$/i.test(last) && last.length > 1) {
    const forms = new Set([escapeRe(last)])
    if (/ies$/i.test(last)) forms.add(`${escapeRe(last.slice(0, -3))}y`)
    else if (/[^s]s$/i.test(last) && last.length > 3) forms.add(escapeRe(last.slice(0, -1)))
    if (/[^aeiou]y$/i.test(last)) forms.add(`${escapeRe(last.slice(0, -1))}ies`)
    tail = `(?:${[...forms].join('|')})(?:e?s)?`
  }
  return boundaryRe(`${join}${tail}`, k, k)
}

/** Words that mean the same thing in postings. Matching a keyword also matches the rest of its group. */
const SYNONYMS: string[][] = [
  ['ml', 'machine learning'],
  ['ai', 'artificial intelligence'],
  ['llm', 'large language model', 'language model'],
  ['nlp', 'natural language processing'],
  ['rl', 'reinforcement learning'],
  ['deep learning', 'neural network'],
  ['compiler', 'mlir', 'llvm'],
  ['photonics', 'photonic', 'silicon photonics'],
  ['optics', 'optical'],
  ['quantum', 'qubit'],
  ['robotics', 'robot'],
  ['inference', 'model serving'],
  ['data science', 'data scientist'],
  ['distributed systems', 'distributed computing'],
]

const reCache = new Map<string, RegExp>()

/** A case-insensitive matcher for a keyword, its plural or singular, and its synonyms. */
export function keywordRe(k: string, opts: { synonyms?: boolean } = {}): RegExp {
  const key = `${opts.synonyms === false ? '-' : '+'}${k.trim().toLowerCase()}`
  let re = reCache.get(key)
  if (!re) {
    const low = k.trim().toLowerCase()
    const group = opts.synonyms === false ? undefined : SYNONYMS.find((g) => g.some((w) => w === low || phraseMatches(w, low)))
    const phrases = [...new Set([k.trim(), ...(group ?? [])])]
    re = new RegExp(phrases.map(phrasePattern).join('|'), 'i')
    reCache.set(key, re)
  }
  return re
}

/** True when `word` is `phrase` up to plural/singular ("compilers" vs "compiler"). */
function phraseMatches(phrase: string, word: string): boolean {
  return new RegExp(`^${phrasePattern(phrase)}$`, 'i').test(word)
}

/** Words that name the kind of role rather than the work, dropped from a target-role phrase. */
const ROLE_WORDS = /\b(?:interns?|internships?|co-?ops?|new grads?|summer|fall|spring|winter|20\d\d)\b/gi

const STOP = new Set(['intern', 'interns', 'internship', 'engineer', 'engineering', 'software', 'and', 'the', 'for', 'of', 'in', 'a', 'an', 'role', 'roles', 'summer', 'student', 'research', 'researcher'])

/** Keywords the user cares about: their keywords plus the meaningful words of their target roles. */
export function wantedKeywords(prefs: Pick<SearchPreferences, 'keywords' | 'targetRoles'>): string[] {
  const out = new Map<string, string>()
  for (const k of prefs.keywords) if (k.trim()) out.set(k.trim().toLowerCase(), k.trim())
  for (const r of prefs.targetRoles) {
    let meaningful = 0
    for (const w of r.split(/[\s,/]+/)) {
      const t = w.trim()
      if (t.length >= 2 && !STOP.has(t.toLowerCase()) && !/^20\d\d$/.test(t)) {
        out.set(t.toLowerCase(), t)
        meaningful++
      }
    }
    // A role made only of common words ("Software engineering intern") still means something as a phrase.
    if (!meaningful) {
      const phrase = r.replace(ROLE_WORDS, ' ').replace(/\s+/g, ' ').trim()
      if (phrase.split(' ').length >= 2) out.set(phrase.toLowerCase(), phrase)
    }
  }
  return [...out.values()]
}

/** Degree words are judged by the eligibility check, not by "skip" words in the description. */
const DEGREE_WORD = /^(?:ph\.?\s?d\.?s?|doctoral|doctorate|master['’]?s?|m\.?s\.?|bachelor['’]?s?|b\.?s\.?|undergrad(?:uate)?s?|graduate students?)$/i

/**
 * The first skip word the posting mentions, and where: the title or department, or its requirements
 * (not the company blurb or benefits). '' when none.
 */
export function excludedBy(p: Pick<JobPosting, 'title' | 'department'> & { description?: string }, exclude: string[]): { word: string; where: string } | null {
  const words = exclude.map((k) => k.trim()).filter(Boolean)
  if (!words.length) return null
  const head = `${p.title}\n${p.department}`
  for (const k of words) if (keywordRe(k, { synonyms: false }).test(head)) return { word: k, where: 'the title or department' }
  const req = p.description ? requirementsExcerpt(p.description, 3000) : ''
  if (!req) return null
  const lines = req.split(/\n+|(?<=[.!?;])\s+/)
  for (const k of words) {
    if (DEGREE_WORD.test(k)) continue
    const re = keywordRe(k, { synonyms: false })
    // "No security clearance required" doesn't ask for one.
    if (lines.some((l) => re.test(l) && !NOT_NEEDED.test(l))) return { word: k, where: 'the requirements' }
  }
  return null
}

/**
 * A sentence that says something is not needed ("Security clearance not required"). Deliberately narrow:
 * "Applicants who do not need sponsorship" still counts as mentioning sponsorship.
 */
const NOT_NEEDED = /\b(?:not|isn['’]t|aren['’]t)\s+(?:\w+\s+)?(?:required|needed|necessary|a requirement)\b|\bno\s+(?:[\w-]+\s+){0,3}(?:is\s+)?(?:required|needed|necessary)\b/i

export interface Skipped {
  posting: JobPosting
  reason: SkipReason
  detail: string
}

export interface FilterResult {
  kept: JobPosting[]
  skipped: Skipped[]
  counts: { total: number } & Record<Exclude<SkipReason, 'shortlist'>, number>
}

/** Why one posting doesn't fit, or null when it does. Postings with no description pass the keyword rule. */
export function skipReason(p: JobPosting, prefs: SearchPreferences, degree: DegreeLevel | null, kws = wantedKeywords(prefs)): Omit<Skipped, 'posting'> | null {
  const types = prefs.roleTypes?.length ? prefs.roleTypes : (['internship'] as RoleType[])
  if (!matchesRoleType(p, types)) return { reason: 'type', detail: `Not one of the ${typeList(types)} you look for` }
  if (!termFits(p, prefs.term)) return { reason: 'term', detail: `The title names another term than ${prefs.term.trim()}` }
  if (locationFit(p.location, prefs) === 'no') return { reason: 'place', detail: `Not in ${placesText(prefs)}` }
  const ex = excludedBy(p, prefs.excludeKeywords)
  if (ex) return { reason: 'excluded', detail: `Mentions “${ex.word}” in ${ex.where}` }
  const why = ineligibleReason(p, degree)
  if (why) return { reason: 'eligibility', detail: why }
  if (kws.length && p.description.trim() && !kws.some((k) => keywordRe(k).test(`${p.title}\n${p.department}\n${p.description}`)))
    return { reason: 'keywords', detail: `Mentions none of: ${kws.slice(0, 6).join(', ')}` }
  return null
}

/** Postings of the wanted types that fit the term, places, skip words, degree level and keywords. */
export function filterPostings(postings: JobPosting[], prefs: SearchPreferences, degree: DegreeLevel | null = null): FilterResult {
  const counts: FilterResult['counts'] = { total: postings.length, type: 0, term: 0, place: 0, excluded: 0, eligibility: 0, keywords: 0 }
  const kws = wantedKeywords(prefs)
  const kept: JobPosting[] = []
  const skipped: Skipped[] = []
  for (const p of postings) {
    const r = skipReason(p, prefs, degree, kws)
    if (!r) kept.push(p)
    else {
      counts[r.reason as keyof typeof counts]++
      skipped.push({ posting: p, ...r })
    }
  }
  return { kept, skipped, counts }
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
  for (const p of postings) {
    const list = byCompany.get(p.company)
    if (list) list.push(p)
    else byCompany.set(p.company, [p])
  }
  const out = new Map<string, Set<string>>()
  for (const [company, list] of byCompany) {
    if (list.length < 4) continue
    const common = kws.filter((k) => list.filter((p) => keywordRe(k).test(p.description)).length / list.length >= 0.6)
    if (common.length) out.set(company, new Set(common))
  }
  return out
}

/** A 0-100 score from keyword, place, term and recency matches, with a plain reason. Used when no AI is connected. */
export function keywordScore(p: JobPosting, prefs: SearchPreferences, now = Date.now(), boilerplate?: Set<string>): Scored {
  const kws = wantedKeywords(prefs)
  const inTitle = kws.filter((k) => keywordRe(k).test(p.title))
  const inBody = kws.filter((k) => !inTitle.includes(k) && !boilerplate?.has(k) && keywordRe(k).test(`${p.department}\n${p.description}`))
  let score = 40
  score += Math.min(40, inTitle.length * 24)
  score += Math.min(16, inBody.length * 4)
  const place = prefs.locations.some((l) => l.trim())
    ? p.location.split(/;|\bor\b/).map((x) => x.trim()).find((x) => x && locationFit(x, { ...prefs, remoteOk: false }) === 'match')
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
  const reason = bits.length ? cap(bits.join('; ')) + '.' : 'A role on a board you follow; no keyword matches.'
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
