/**
 * Decides what goes in each form field. Pure functions over FieldDescriptor[] and
 * the Profile, so every rule is covered by match.test.ts.
 *
 * Rules: a field is filled only from a value the user saved. Nothing is guessed,
 * EEO answers come only from the profile's demographics, "decline" maps to the
 * form's decline option, and names in a native language or script are left alone.
 */
import type { Profile } from '@shared/profile'
import { CHOICE_KINDS, type FieldDescriptor, type FieldKind } from './fields'

// ---------------------------------------------------------------------------
// What a field wants

export type Want =
  /** Best text match among the options for any of the targets. */
  | { type: 'text'; targets: string[] }
  | { type: 'yesno'; yes: boolean }
  /** The "decline to self-identify" option. */
  | { type: 'decline' }
  /** EEO-style options that read as yes or no ("I am not a protected veteran"). */
  | { type: 'polar'; yes: boolean; targets: string[]; qualifier?: string }
  | { type: 'degree'; degree: string }
  | { type: 'month'; month: number }
  | { type: 'graduation'; year: number; month: number | null; now: { year: number; month: number } }
  | { type: 'gpa'; gpa: string }
  | { type: 'country'; country: string }
  /** City autocomplete: options look like "Berkeley, California, United States". */
  | { type: 'location'; city: string; region: string; country: string }

export interface Intent {
  /** Which profile value this is, e.g. "email", "education.0.school", "answer:<id>". */
  what: string
  /** The value for a free-text control. */
  text: string
  want: Want
  /** What to type into a combobox whose options only load after typing. */
  search?: string
}

export interface FillAction {
  key: string
  label: string
  kind: FieldKind
  what: string
  multi: boolean
  /** Text to enter, or the exact option text to choose. Absent when the options load as you type. */
  value?: string
  /** For comboboxes without known options: type `search`, then choose with `want`. */
  want?: Want
  search?: string
}

export interface FillPlan {
  actions: FillAction[]
  /** Labels of required fields nothing could be filled for. */
  needsYou: string[]
}

// ---------------------------------------------------------------------------
// Text helpers

/** Lowercase, no accents, punctuation as spaces, single-spaced. */
export function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const STOP = new Set(
  'a an the and or of to in on at for by with from as is are was were be been being do does did will would can could should shall may might must have has had i me my mine you your yours we us our they them their this that these those it its there here please if any what which who whom whose job role position company team organization opportunity currently'.split(
    ' ',
  ),
)

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

export function tokens(s: string): string[] {
  return [...new Set(norm(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem))]
}

/** Dice coefficient over meaningful words, 0..1. */
export function similarity(a: string, b: string): number {
  const na = norm(a)
  const nb = norm(b)
  if (na && na === nb) return 1
  const ta = tokens(a)
  const tb = new Set(tokens(b))
  if (!ta.length || !tb.size) return 0
  const shared = ta.filter((t) => tb.has(t)).length
  return (2 * shared) / (ta.length + tb.size)
}

/** Drops phone dial codes and parentheticals: "United States +1" -> "United States". */
const stripOption = (s: string) => s.replace(/\s*\+\d[\d\s-]*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim()

/** How well one option's text matches a wanted value, 0..1. */
export function optionScore(option: string, target: string): number {
  const o = norm(option)
  const t = norm(target)
  if (!o || !t) return 0
  if (o === t) return 1
  const os = norm(stripOption(option))
  if (os && os === t) return 0.97
  if (o.startsWith(t + ' ') || t.startsWith(o + ' ')) return 0.85
  if (` ${o} `.includes(` ${t} `) || ` ${t} `.includes(` ${o} `)) return 0.75
  return 0.8 * similarity(o, t)
}

export const DECLINE =
  /decline|don'?t wish|do not wish|prefer not|not to (answer|say|disclose|self.?identify|specify|respond)|choose not|rather not|do not want to|don'?t want to|wish not to/i

/** true for "Yes…", false for "No…"/"I am not…", null for anything else. */
export function polarity(s: string): boolean | null {
  const n = norm(s)
  if (!n || DECLINE.test(s)) return null
  if (/^no\b/.test(n) || /\b(not|do not|dont|never)\b/.test(n)) return false
  if (/^yes\b/.test(n) || /^i (identify|have|am)\b/.test(n)) return true
  return null
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
export const monthName = (m: number) => MONTHS[m - 1]!.replace(/^./, (c) => c.toUpperCase())

function monthOf(word: string): number | null {
  const w = word.toLowerCase()
  if (w.length < 3) return null
  const i = MONTHS.findIndex((m) => m.startsWith(w))
  return i >= 0 ? i + 1 : null
}

/** "2027-05", "05/2027", "May 2027", "2027" -> { year, month }. */
export function parseYearMonth(s: string): { year: number; month: number | null } | null {
  const t = s.trim()
  let m = /^(\d{4})-(\d{1,2})/.exec(t)
  if (m) return { year: Number(m[1]), month: clampMonth(Number(m[2])) }
  m = /^(\d{1,2})\s*\/\s*(\d{4})$/.exec(t)
  if (m) return { year: Number(m[2]), month: clampMonth(Number(m[1])) }
  const year = /\b(19|20)\d{2}\b/.exec(t)
  if (!year) return null
  const word = /[a-z]{3,}/i.exec(t.replace(year[0], ''))
  return { year: Number(year[0]), month: word ? monthOf(word[0]) : null }
}
const clampMonth = (n: number) => (n >= 1 && n <= 12 ? n : null)

/** "B.S." -> bachelor, "Master of Business Administration (M.B.A.)" -> mba. */
export function degreeKind(s: string): string {
  const n = s.toLowerCase().replace(/[.'’]/g, '')
  if (/\bmba\b|business administration/.test(n)) return 'mba'
  if (/\bph ?d\b|doctor of philosophy|doctorate|\bdphil\b/.test(n)) return 'phd'
  if (/\bmd\b|doctor of medicine/.test(n)) return 'md'
  if (/\bjd\b|juris/.test(n)) return 'jd'
  if (/bachelor|\b(bs|ba|bsc|bse|beng|bas|bfa|ab|sb|bba|barch|undergrad\w*)\b/.test(n)) return 'bachelor'
  if (/master|\b(ms|ma|msc|mse|meng|mphil|mfa|mpp|mph|sm|mres)\b/.test(n)) return 'master'
  if (/associate|\b(aa|as|aas)\b/.test(n)) return 'associate'
  if (/engineers degree/.test(n)) return 'engineer'
  if (/high school|secondary school|\bged\b/.test(n)) return 'highschool'
  return ''
}

const COUNTRY_ALIASES: Record<string, string> = {
  us: 'United States',
  usa: 'United States',
  'u s': 'United States',
  'u s a': 'United States',
  'united states of america': 'United States',
  america: 'United States',
  uk: 'United Kingdom',
  'u k': 'United Kingdom',
  'great britain': 'United Kingdom',
  britain: 'United Kingdom',
  england: 'United Kingdom',
  uae: 'United Arab Emirates',
  'south korea': 'Korea, Republic of',
}
export const canonicalCountry = (c: string) => COUNTRY_ALIASES[norm(c)] ?? c.trim()

const US_STATES: Record<string, string> = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California', co: 'Colorado', ct: 'Connecticut', de: 'Delaware',
  dc: 'District of Columbia', fl: 'Florida', ga: 'Georgia', hi: 'Hawaii', id: 'Idaho', il: 'Illinois', in: 'Indiana', ia: 'Iowa',
  ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana', me: 'Maine', md: 'Maryland', ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota',
  ms: 'Mississippi', mo: 'Missouri', mt: 'Montana', ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire', nj: 'New Jersey',
  nm: 'New Mexico', ny: 'New York', nc: 'North Carolina', nd: 'North Dakota', oh: 'Ohio', ok: 'Oklahoma', or: 'Oregon',
  pa: 'Pennsylvania', ri: 'Rhode Island', sc: 'South Carolina', sd: 'South Dakota', tn: 'Tennessee', tx: 'Texas', ut: 'Utah',
  vt: 'Vermont', va: 'Virginia', wa: 'Washington', wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming',
}
const regionNames = (r: string) => [norm(r), norm(US_STATES[norm(r)] ?? '')].filter(Boolean)

// ---------------------------------------------------------------------------
// Choosing an option

/** The option to pick for a wanted value, or null when none matches well enough. Never guesses. */
export function chooseOption(options: string[], want: Want): string | null {
  const opts = options.filter((o) => o.trim())
  if (!opts.length) return null
  switch (want.type) {
    case 'text':
      return bestText(opts, want.targets, 0.6)
    case 'decline':
      return opts.find((o) => DECLINE.test(o)) ?? null
    case 'yesno': {
      const w = want.yes ? 'yes' : 'no'
      return opts.find((o) => norm(o) === w) ?? opts.find((o) => !DECLINE.test(o) && norm(o).startsWith(w + ' ')) ?? null
    }
    case 'polar': {
      const exact = bestText(opts, want.targets, 0.97)
      if (exact) return exact
      const same = opts.filter((o) => polarity(o) === want.yes && (!want.qualifier || norm(o).includes(want.qualifier)))
      return same.length === 1 ? same[0]! : null
    }
    case 'degree': {
      const kind = degreeKind(want.degree)
      if (!kind) return bestText(opts, [want.degree], 0.75)
      return opts.find((o) => degreeKind(o) === kind) ?? null
    }
    case 'month':
      return (
        opts.find((o) => {
          const n = norm(o)
          return n === MONTHS[want.month - 1] || n === MONTHS[want.month - 1]!.slice(0, 3) || Number(n) === want.month
        }) ?? null
      )
    case 'graduation':
      return chooseGraduation(opts, want)
    case 'gpa':
      return chooseGpa(opts, want.gpa)
    case 'country': {
      const c = canonicalCountry(want.country)
      return bestText(opts, [c], 0.85)
    }
    case 'location':
      return chooseLocation(opts, want)
  }
}

function bestText(opts: string[], targets: string[], min: number): string | null {
  let best: string | null = null
  let score = 0
  for (const t of targets) {
    for (const o of opts) {
      const s = optionScore(o, t)
      if (s > score) {
        score = s
        best = o
      }
    }
  }
  return score >= min ? best : null
}

function chooseLocation(opts: string[], want: { city: string; region: string; country: string }): string | null {
  const city = norm(want.city)
  if (!city) return null
  const regions = want.region ? regionNames(want.region) : []
  const country = want.country ? norm(canonicalCountry(want.country)) : ''
  const candidates = opts
    .map((o, i) => {
      const parts = o.split(',').map(norm)
      if (parts[0] !== city) return null
      const rest = parts.slice(1)
      const regionHit = regions.length > 0 && rest.some((p) => regions.includes(p))
      const countryHit = !!country && rest.some((p) => p === country || norm(canonicalCountry(p)) === country)
      return { o, i, regionHit, countryHit }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
  if (!candidates.length) return null
  // With a saved region or country, only an option that agrees with it counts.
  const scored = candidates
    .filter((c) => (!regions.length || c.regionHit) && (!country || c.countryHit || (regions.length > 0 && c.regionHit)))
    .sort((a, b) => Number(b.regionHit) + Number(b.countryHit) - (Number(a.regionHit) + Number(a.countryHit)) || a.i - b.i)
  if (scored.length) return scored[0]!.o
  return regions.length || country ? null : candidates[0]!.o
}

const SEASONS: Record<string, [number, number]> = { spring: [1, 5], summer: [6, 8], fall: [9, 12], autumn: [9, 12], winter: [1, 2] }

/** "May - Aug 2027" -> May..Aug 2027 as month numbers (year * 12 + month); "Fall 2027" -> Sep..Dec 2027. */
function periodOf(n: string): { from: number; to: number; whole: boolean } | null {
  const years = [...n.matchAll(/\b(19|20)\d{2}\b/g)].map((x) => Number(x[0]))
  if (years.length !== 1) return null
  const y = years[0]! * 12
  const spans: [number, number][] = []
  for (const w of n.split(' ')) {
    const season = SEASONS[w]
    if (season) spans.push(season)
    else if (/^[a-z]{3,}$/.test(w)) {
      const mo = monthOf(w)
      if (mo) spans.push([mo, mo])
    }
  }
  if (!spans.length) return { from: y + 1, to: y + 12, whole: true }
  return { from: y + Math.min(...spans.map((s) => s[0])), to: y + Math.max(...spans.map((s) => s[1])), whole: false }
}

function chooseGraduation(opts: string[], want: { year: number; month: number | null; now: { year: number; month: number } }): string | null {
  const nowAt = want.now.year * 12 + want.now.month
  for (const o of opts) {
    const n = norm(o)
    const period = periodOf(n)
    if (!period) {
      if (/already|graduated|completed|alumni/.test(n) && want.year * 12 + (want.month ?? 12) < nowAt) return o
      continue
    }
    const before = /\b(earlier than|before|prior to)\b/.test(n)
    const after = /\b(later than|after)\b/.test(n)
    const orEarlier = /\b(or|and) (earlier|before)\b/.test(n)
    const orLater = /\b(or|and) (later|after)\b|\bonwards?\b/.test(n)
    if (want.month === null) {
      // Only the year is known: only a plain whole-year option is a sure match.
      if (period.whole && !before && !after && !orEarlier && !orLater && period.from === want.year * 12 + 1) return o
      continue
    }
    const m = want.year * 12 + want.month
    const hit = before ? m < period.from : after ? m > period.to : orEarlier ? m <= period.to : orLater ? m >= period.from : m >= period.from && m <= period.to
    if (hit) return o
  }
  return null
}

/** "3.7", "3.7/4.0" -> 3.7 on a 4.0 scale; null for other scales. */
function gpaOnFour(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/.exec(s.trim())
  if (!m) return null
  const v = Number(m[1])
  const scale = m[2] ? Number(m[2]) : 4
  return scale === 4 && v <= 4 ? v : null
}

/** GPA bands like "3.4 - 3.5 (out of 4.0)", "3.6 or above", "2.4 or below". Percent bands are skipped. */
function chooseGpa(opts: string[], gpa: string): string | null {
  const exact = bestText(opts, [gpa], 0.97)
  if (exact) return exact
  const v = gpaOnFour(gpa)
  if (v === null) return null
  for (const o of opts) {
    if (/%|percent/.test(o)) continue
    const nums = [...o.matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0])).filter((x) => x <= 4.0 && !(x === 4 && /out of 4/.test(o) && !/^4/.test(o.trim())))
    const n = norm(o)
    if (nums.length >= 2 && v >= nums[0]! && v <= nums[1]!) return o
    if (nums.length === 1 && /above|higher|\bup\b|or more|\+/.test(n) && v >= nums[0]!) return o
    if (nums.length === 1 && /below|lower|under|or less/.test(n) && v <= nums[0]!) return o
  }
  return null
}

// ---------------------------------------------------------------------------
// Classifying fields

/** Name fields that ask for a non-Latin script or the native-language form. Never filled. */
const NATIVE_NAME = /native|local language|original (language|script)|non.?latin|in your (own )?language|chinese|japanese|korean|kanji|kana|hanzi|hangul|cyrillic|arabic script|pinyin|pronunc|phonetic/i

const OTHER_COUNTRY =
  /\b(canada|canadian|united kingdom|\buk\b|britain|ireland|european union|\beu\b|europe|germany|france|netherlands|spain|italy|switzerland|sweden|poland|india|china|japan|korea|singapore|australia|new zealand|israel|brazil|mexico|uae|emirates)\b/i

function textIntent(what: string, value: string | undefined | null): Intent | null {
  const v = (value ?? '').trim()
  return v ? { what, text: v, want: { type: 'text', targets: [v] } } : null
}

function yesNoIntent(what: string, v: boolean | null): Intent | null {
  return v === null ? null : { what, text: v ? 'Yes' : 'No', want: { type: 'yesno', yes: v } }
}

const GENDER_SYNONYMS: Record<string, string[]> = {
  male: ['Male', 'Man'],
  man: ['Man', 'Male'],
  female: ['Female', 'Woman'],
  woman: ['Woman', 'Female'],
  'non binary': ['Non-binary', 'Nonbinary', 'Non-Binary / Non-Conforming'],
  nonbinary: ['Non-binary', 'Nonbinary'],
}

/** EEO answer, only from what the user saved. */
function demographicIntent(what: string, saved: string, mode: 'text' | 'polar'): Intent | null {
  const v = saved.trim()
  if (!v) return null
  if (v.toLowerCase() === 'decline') return { what, text: 'Decline to self-identify', want: { type: 'decline' } }
  if (mode === 'polar') {
    const yes = polarity(v)
    // "Not a protected veteran" doesn't answer "Are you a veteran?": only options about protected status qualify.
    const qualifier = yes === false && /protected/i.test(v) ? 'protected' : undefined
    if (yes !== null) return { what, text: v, want: { type: 'polar', yes, targets: [v], qualifier } }
  }
  const targets = GENDER_SYNONYMS[norm(v)] ?? [v]
  return { what, text: v, want: { type: 'text', targets } }
}

/** Index of an education block from ids like "school--0" or "education_school_name_1". */
function eduIndex(f: FieldDescriptor): number {
  const m = /--(\d+)$/.exec(f.id) ?? /_(\d+)$/.exec(f.id) ?? /\[(\d+)\]/.exec(f.name)
  return m ? Number(m[1]) : 0
}

/** Maps one field to the profile value it asks for, or null when there is no saved value or no clear match. */
export function classify(f: FieldDescriptor, p: Profile, now: Date = new Date()): Intent | null {
  if (f.kind === 'file') return null
  const label = f.label.replace(/\s+/g, ' ').trim()
  const l = label.toLowerCase()
  const id = `${f.id} ${f.name}`.toLowerCase()
  const ac = f.autocomplete.toLowerCase()
  const isText = !CHOICE_KINDS.includes(f.kind)
  const nameish = /name/.test(l) || /name/.test(id)

  if (nameish && (NATIVE_NAME.test(label) || NATIVE_NAME.test(id))) return null

  // Names
  if (/preferred_name/.test(id) || /preferred (first )?name|nick ?name|name you go by/.test(l))
    return isText ? textIntent('preferredName', p.preferredName) : null
  if (/(^|[^a-z])first_?name\b/.test(id) || ac === 'given-name' || /^(legal )?first name$|^given name$/.test(l))
    return isText ? textIntent('legalFirstName', p.legalFirstName) : null
  if (/(^|[^a-z])last_?name\b/.test(id) || ac === 'family-name' || /^(legal )?last name$|surname|family name/.test(l))
    return isText ? textIntent('legalLastName', p.legalLastName) : null
  if (ac === 'name' || /^(full |legal |your )?(full )?name$/.test(l)) {
    const full = [p.legalFirstName.trim(), p.legalLastName.trim()].filter(Boolean).join(' ')
    return isText && p.legalFirstName.trim() && p.legalLastName.trim() ? textIntent('fullName', full) : null
  }

  // Contact
  if ((/(^|\s)email\b/.test(id) || ac === 'email' || f.kind === 'email' || /\be-?mail\b/.test(l)) && !/reference|referr|manager|recruiter/.test(l))
    return isText ? textIntent('email', p.email) : null
  const phoneCountry = (f.id === 'country' && /phone/i.test(f.group)) || /phone.*country|country code|dial(ing)? code/.test(l)
  if (phoneCountry || /^country( of residence)?$/.test(l)) {
    const c = p.country.trim()
    return c ? { what: 'country', text: canonicalCountry(c), want: { type: 'country', country: c }, search: canonicalCountry(c) } : null
  }
  if ((/(^|\s)phone\b/.test(id) || f.kind === 'tel' || ac.startsWith('tel') || /phone|mobile number|\bcell\b/.test(l)) && !/type|extension/.test(l))
    return isText ? textIntent('phone', p.phone) : null

  // Location
  if (/candidate-location/.test(id) || /^(current )?location( \(city\))?$|^where are you (currently )?(based|located)\b|^city,? state$/.test(l)) {
    const city = p.city.trim()
    if (!city) return null
    const text = [city, p.region.trim()].filter(Boolean).join(', ')
    return { what: 'location', text, search: city, want: { type: 'location', city, region: p.region.trim(), country: p.country.trim() } }
  }
  if (/^(current )?city$/.test(l)) return textIntent('city', p.city)
  if (/^(state|province|region|state\s*\/\s*province)$/.test(l)) return isText ? textIntent('region', p.region) : null

  // Links
  if (/linkedin/.test(l) || /linkedin/.test(id)) return isText ? textIntent('linkedin', p.linkedin) : null
  if (/github/.test(l) || /github/.test(id)) return isText ? textIntent('github', p.github) : null
  if (/google scholar/.test(l)) return isText ? textIntent('scholar', p.scholar) : null
  if (/^(personal )?(website|web site|portfolio|blog)( url| link)?$|^(personal website|portfolio)\b|website or portfolio|portfolio or website/.test(l) && !/twitter|x\.com|other/.test(l))
    return isText ? textIntent('website', p.website) : null

  // Education
  const edu = p.education[eduIndex(f)]
  const fid = f.id.toLowerCase()
  if (/^school--\d+$|school_name/.test(fid) || /^(school|university|college|institution)( name)?$/.test(l)) {
    const school = edu?.school.trim()
    return school ? { what: `education.${eduIndex(f)}.school`, text: school, search: school, want: { type: 'text', targets: [school] } } : null
  }
  if (/^degree--\d+$|education_degree/.test(fid) || /^degree( type)?$|^highest (level of )?(education|degree)/.test(l)) {
    const degree = edu?.degree.trim()
    return degree ? { what: `education.${eduIndex(f)}.degree`, text: degree, want: { type: 'degree', degree } } : null
  }
  if (/^discipline--\d+$|education_discipline/.test(fid) || /^(discipline|major|field of study|area of study|major\s*\/\s*field of study)$/.test(l)) {
    const field = edu?.field.trim()
    return field ? { what: `education.${eduIndex(f)}.field`, text: field, search: field, want: { type: 'text', targets: [field] } } : null
  }
  const dateField = /^(start|end)-(month|year)--\d+$/.exec(fid) ?? /^(start|end) date (month|year)$/.exec(l)
  if (dateField) {
    const ym = edu ? parseYearMonth(dateField[1] === 'start' ? edu.startDate : edu.endDate) : null
    if (!ym) return null
    const what = `education.${eduIndex(f)}.${dateField[1]}${dateField[2] === 'month' ? 'Month' : 'Year'}`
    if (dateField[2] === 'year') return { what, text: String(ym.year), want: { type: 'text', targets: [String(ym.year)] } }
    return ym.month ? { what, text: monthName(ym.month), want: { type: 'month', month: ym.month } } : null
  }
  if (/\bgpa\b|grade point/.test(l)) {
    const gpa = p.education[0]?.gpa.trim()
    return gpa ? { what: 'education.0.gpa', text: gpa, want: { type: 'gpa', gpa } } : null
  }
  if (/graduat/.test(l) && /date|year|month|when|expected/.test(l) && !/school|university|college|degree|major/.test(l)) {
    const ym = p.education[0] ? parseYearMonth(p.education[0].endDate) : null
    if (!ym) return null
    const text = ym.month ? `${monthName(ym.month)} ${ym.year}` : String(ym.year)
    return { what: 'education.0.graduation', text, want: { type: 'graduation', year: ym.year, month: ym.month, now: { year: now.getFullYear(), month: now.getMonth() + 1 } } }
  }

  // Work authorization
  if (/sponsor/.test(l)) {
    // "Are you authorized to work in the US without sponsorship?" asks the opposite of "Do you need sponsorship?"
    if (/without/.test(l) && /authori[sz]ed|eligible|able|legally/.test(l)) {
      if (OTHER_COUNTRY.test(label)) return null
      const a = p.authorizedToWorkUS
      const s = p.needsSponsorship
      return yesNoIntent('authorizedWithoutSponsorship', a === false || s === true ? false : a === true && s === false ? true : null)
    }
    return yesNoIntent('needsSponsorship', p.needsSponsorship)
  }
  if (/(authori[sz]ed|eligible|legally (able|permitted|allowed)|right|permission) to (work|be employed)|work authori[sz]ation/.test(l)) {
    if (OTHER_COUNTRY.test(label)) return null
    return yesNoIntent('authorizedToWorkUS', p.authorizedToWorkUS)
  }

  // Voluntary self-identification. Only the user's saved answers, never inferred.
  const d = p.demographics
  if (/transgender|sexual orientation|lgbt/.test(l)) return null
  if (/hispanic_ethnicity/.test(id) || /hispanic|latin[oax]/.test(l)) return demographicIntent('demographics.hispanicLatino', d.hispanicLatino, 'polar')
  if (/^gender$/.test(fid) || /\bgender\b/.test(l)) return demographicIntent('demographics.gender', d.gender, 'text')
  if (/^race$/.test(fid) || /\brace\b|racial|ethnicity|ethnic background/.test(l)) return demographicIntent('demographics.race', d.race, 'text')
  if (/veteran/.test(id) || /veteran/.test(l)) return demographicIntent('demographics.veteran', d.veteran, 'polar')
  if (/disability/.test(id) || /disabilit/.test(l)) return demographicIntent('demographics.disability', d.disability, 'polar')
  if (/pronoun/.test(l)) return demographicIntent('demographics.pronouns', d.pronouns, 'text')

  return savedAnswerIntent(label, p)
}

/** Custom questions: the saved answer whose question reads most like this label. */
export function savedAnswerIntent(label: string, p: Profile, min = 0.7): Intent | null {
  if (tokens(label).length === 0) return null
  let best: { id: string; answer: string; score: number } | null = null
  for (const a of p.answers) {
    if (!a.answer.trim() || !a.question.trim()) continue
    const score = similarity(label, a.question)
    if (score >= min && (!best || score > best.score)) best = { id: a.id, answer: a.answer.trim(), score }
  }
  return best ? { what: `answer:${best.id}`, text: best.answer, want: { type: 'text', targets: [best.answer] } } : null
}

// ---------------------------------------------------------------------------
// Planning

const AFFIRM = /^(yes|true|i agree|agree|i acknowledge|acknowledged?|checked|i consent|consent)\b/i

/** Turns descriptors into fill actions. Fields that already have a value are left alone. */
export function planFill(fields: FieldDescriptor[], p: Profile, now: Date = new Date()): FillPlan {
  const actions: FillAction[] = []
  const needsYou: string[] = []
  for (const f of fields) {
    if (f.hasValue) continue
    const intent = classify(f, p, now)
    const action = intent ? toAction(f, intent) : null
    if (action) actions.push(action)
    else if (f.required && f.kind !== 'file') needsYou.push(f.label || f.name || f.id)
  }
  return { actions, needsYou }
}

function toAction(f: FieldDescriptor, intent: Intent): FillAction | null {
  const base = { key: f.key, label: f.label, kind: f.kind, what: intent.what, multi: f.multi }
  switch (f.kind) {
    case 'file':
      return null
    case 'checkbox':
      return AFFIRM.test(intent.text) ? { ...base, value: 'true' } : null
    case 'select':
    case 'radio':
    case 'checkboxes': {
      const value = chooseOption(f.options, intent.want)
      return value ? { ...base, value } : null
    }
    case 'combobox': {
      if (f.options.length) {
        const value = chooseOption(f.options, intent.want)
        if (value) return { ...base, value }
        // Options were listed but none matched. A search can still find it in long lists (schools, cities).
        return intent.search ? { ...base, want: intent.want, search: intent.search } : null
      }
      return { ...base, want: intent.want, search: intent.search ?? intent.text }
    }
    case 'number': {
      const n = intent.text.replace(/[^\d.]/g, '')
      return n ? { ...base, value: n } : null
    }
    default:
      return { ...base, value: intent.text }
  }
}

/** True when the profile has nothing autofill could use. */
export function isProfileEmpty(p: Profile): boolean {
  return ![p.legalFirstName, p.legalLastName, p.preferredName, p.email, p.phone].some((v) => v.trim())
}
