/** Everything about the applicant. Stored locally only; sensitive parts encrypted at rest. */
export interface Education {
  school: string
  degree: string
  field: string
  /** "YYYY-MM" */
  startDate: string
  /** "YYYY-MM"; may be in the future (expected graduation). */
  endDate: string
  gpa: string
}

export type Choice = '' | 'decline' | string

export interface Demographics {
  gender: Choice
  pronouns: string
  hispanicLatino: Choice
  race: Choice
  veteran: Choice
  disability: Choice
}

export interface SearchPreferences {
  /** e.g. "ML inference intern", "photonics intern" */
  targetRoles: string[]
  locations: string[]
  remoteOk: boolean
  term: string
  minPay: string
  keywords: string[]
  excludeKeywords: string[]
  notes: string
}

export interface SavedAnswer {
  id: string
  question: string
  answer: string
}

export interface StoredResume {
  fileName: string
  /** Absolute path of the app's own copy, under <dataDir>/resumes/. */
  storedPath: string
  /** Plain text extracted from the file; '' when none could be found. */
  text: string
  updatedAt: string
}

/**
 * An application track: a resume plus the profile variations for one kind of role
 * (e.g. "ML inference" vs "Photonics hardware"). Roles point at a track by id.
 */
export interface ApplicationTrack {
  id: string
  name: string
  description: string
  resume: StoredResume | null
  /** What this track looks for; autosearch ranks against the best-matching track. */
  targetRoles: string[]
  keywords: string[]
  /** Answers that differ for this track; they take precedence over the profile's saved answers. */
  answers: SavedAnswer[]
}

export const DEFAULT_TRACK_ID = 'default'

/** Name given to the first track, made from the profile's existing resume and preferences. */
export const FIRST_TRACK_NAME = 'General'

/** The implicit track used when the user has not created any: the profile's own resume and preferences. */
export function defaultTrack(p: Profile): ApplicationTrack {
  return {
    id: DEFAULT_TRACK_ID,
    name: 'General',
    description: '',
    resume: p.resume,
    targetRoles: p.preferences.targetRoles,
    keywords: p.preferences.keywords,
    answers: [],
  }
}

/** The tracks in effect: the user's (the first is the default), or the implicit default. Never empty. */
export function profileTracks(p: Profile): ApplicationTrack[] {
  return p.tracks.length ? p.tracks : [defaultTrack(p)]
}

/** The track a role uses: its trackId when that track exists, else the default (first) track. */
export function trackById(p: Profile, trackId: string | null | undefined): ApplicationTrack {
  const all = profileTracks(p)
  return (trackId ? all.find((t) => t.id === trackId) : undefined) ?? all[0]!
}

/** The resume for a role's track: the track's own, else the default track's, else the profile's. */
export function resumeForTrack(p: Profile, trackId: string | null | undefined): StoredResume | null {
  return trackById(p, trackId).resume ?? profileTracks(p)[0]!.resume ?? p.resume
}

const questionKey = (q: string) => q.trim().toLowerCase().replace(/[\s?.!:]+$/g, '').replace(/\s+/g, ' ')

/**
 * The saved answers to use for a track: the track's overrides first, then the
 * profile's answers to questions the track doesn't override (matched ignoring
 * case and trailing punctuation).
 */
export function answersForTrack(p: Profile, track: ApplicationTrack): SavedAnswer[] {
  const own = track.answers.filter((a) => a.question.trim())
  const overridden = new Set(own.map((a) => questionKey(a.question)))
  return [...own, ...p.answers.filter((a) => !overridden.has(questionKey(a.question)))]
}

/** What the renderer may change on a track through profile:updateTrack. Resumes have their own channels. */
export type TrackPatch = Partial<Pick<ApplicationTrack, 'name' | 'description' | 'targetRoles' | 'keywords' | 'answers'>>

export interface Profile {
  legalFirstName: string
  legalLastName: string
  preferredName: string
  email: string
  phone: string
  city: string
  region: string
  country: string
  linkedin: string
  github: string
  website: string
  scholar: string
  education: Education[]
  authorizedToWorkUS: boolean | null
  needsSponsorship: boolean | null
  demographics: Demographics
  preferences: SearchPreferences
  /** Reusable answers: SAT score, "how did you hear about us", start date, etc. */
  answers: SavedAnswer[]
  resume: StoredResume | null
  /** Empty means a single implicit default track (see defaultTrack). */
  tracks: ApplicationTrack[]
}

export const EMPTY_EDUCATION: Education = { school: '', degree: '', field: '', startDate: '', endDate: '', gpa: '' }

export const EMPTY_PROFILE: Profile = {
  legalFirstName: '',
  legalLastName: '',
  preferredName: '',
  email: '',
  phone: '',
  city: '',
  region: '',
  country: '',
  linkedin: '',
  github: '',
  website: '',
  scholar: '',
  education: [],
  authorizedToWorkUS: null,
  needsSponsorship: null,
  demographics: { gender: '', pronouns: '', hispanicLatino: '', race: '', veteran: '', disability: '' },
  preferences: {
    targetRoles: [],
    locations: [],
    remoteOk: true,
    term: '',
    minPay: '',
    keywords: [],
    excludeKeywords: [],
    notes: '',
  },
  answers: [],
  resume: null,
  tracks: [],
}

/** Where things live and whether the keychain is protecting them. */
export interface ProfileStatus {
  /** True when the OS keychain is available, so the profile is encrypted at rest. */
  encrypted: boolean
  dataDir: string
  /** null in demo mode, where the database lives only in memory. */
  databasePath: string | null
  resumesDir: string
  demo: boolean
  platform: string
}

export interface ResumeImport {
  profile: Profile
  /** Set when the file was kept but something needs the user's attention (e.g. a scanned PDF). */
  warning: string | null
}

export const RESUME_EXTENSIONS = ['pdf', 'docx', 'txt', 'md'] as const
export const RESUME_MAX_BYTES = 15 * 1024 * 1024

export interface ProfileChannels {
  'profile:get': { req: void; res: Profile }
  'profile:save': { req: Profile; res: Profile }
  /** Opens a file picker, stores a copy of the resume and extracts its text. null if cancelled. */
  'profile:importResume': { req: void; res: ResumeImport | null }
  /** Same as importResume, for a file dropped on the window (the renderer reads the bytes). */
  'profile:importResumeData': { req: { fileName: string; data: Uint8Array }; res: ResumeImport }
  /** Deletes the stored resume copy and its text. */
  'profile:removeResume': { req: void; res: Profile }
  /** Writes a JSON export the user chooses a location for. null if cancelled. */
  'profile:exportAll': { req: void; res: { path: string } | null }
  /** Deletes every local record: roles, profile, chats, keys and resume copies. */
  'profile:deleteAll': { req: void; res: void }
  /** Shows the data folder in Finder / Explorer. */
  'profile:revealData': { req: void; res: void }
  'profile:status': { req: void; res: ProfileStatus }

  // Application tracks. The first track is the default; roles with no (or an unknown) trackId use it.
  /**
   * Adds a track at the end. The first track created takes over the profile's
   * resume, target roles and keywords and is named "General" unless a name is given.
   */
  'profile:createTrack': { req: { name?: string }; res: { profile: Profile; trackId: string } }
  /** Renames a track or changes its description, target roles, keywords or answer overrides. */
  'profile:updateTrack': { req: { id: string; patch: TrackPatch }; res: Profile }
  /** Deletes a track and its resume file; roles on it fall back to the default track. */
  'profile:deleteTrack': { req: { id: string }; res: Profile }
  /** New order, as track ids. Ids left out keep their relative order at the end. */
  'profile:reorderTracks': { req: { ids: string[] }; res: Profile }
  /** Moves a track to the front, which makes it the default. */
  'profile:setDefaultTrack': { req: { id: string }; res: Profile }
  /** File picker for one track's resume. null if cancelled. */
  'profile:importTrackResume': { req: { id: string }; res: ResumeImport | null }
  /** Dropped bytes for one track's resume. */
  'profile:importTrackResumeData': { req: { id: string; fileName: string; data: Uint8Array }; res: ResumeImport }
  /** Deletes one track's resume file and text. */
  'profile:removeTrackResume': { req: { id: string }; res: Profile }
}

export interface ProfileEvents {
  'profile:changed': Record<string, never>
}

// ---------------------------------------------------------------------------
// Normalizing and validating. Shared so the form shows the same errors the
// main process would refuse with.

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const triState = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/**
 * Lays stored (possibly older or partial) data over EMPTY_PROFILE so fields
 * added in later versions get their defaults and wrong types are dropped.
 */
export function mergeWithDefaults(raw: unknown): Profile {
  const r = isObj(raw) ? raw : {}
  const d = isObj(r['demographics']) ? r['demographics'] : {}
  const p = isObj(r['preferences']) ? r['preferences'] : {}
  const e = EMPTY_PROFILE
  return {
    legalFirstName: str(r['legalFirstName']),
    legalLastName: str(r['legalLastName']),
    preferredName: str(r['preferredName']),
    email: str(r['email']),
    phone: str(r['phone']),
    city: str(r['city']),
    region: str(r['region']),
    country: str(r['country']),
    linkedin: str(r['linkedin']),
    github: str(r['github']),
    website: str(r['website']),
    scholar: str(r['scholar']),
    education: (Array.isArray(r['education']) ? r['education'] : []).filter(isObj).map((x) => ({
      school: str(x['school']),
      degree: str(x['degree']),
      field: str(x['field']),
      startDate: str(x['startDate']),
      endDate: str(x['endDate']),
      gpa: str(x['gpa']),
    })),
    authorizedToWorkUS: triState(r['authorizedToWorkUS']),
    needsSponsorship: triState(r['needsSponsorship']),
    demographics: {
      gender: str(d['gender']),
      pronouns: str(d['pronouns']),
      hispanicLatino: str(d['hispanicLatino']),
      race: str(d['race']),
      veteran: str(d['veteran']),
      disability: str(d['disability']),
    },
    preferences: {
      targetRoles: strList(p['targetRoles']),
      locations: strList(p['locations']),
      remoteOk: typeof p['remoteOk'] === 'boolean' ? p['remoteOk'] : e.preferences.remoteOk,
      term: str(p['term']),
      minPay: str(p['minPay']),
      keywords: strList(p['keywords']),
      excludeKeywords: strList(p['excludeKeywords']),
      notes: str(p['notes']),
    },
    answers: mergeAnswers(r['answers']),
    resume: mergeResume(r['resume']),
    tracks: mergeTracks(r['tracks']),
  }
}

function mergeAnswers(v: unknown): SavedAnswer[] {
  return (Array.isArray(v) ? v : []).filter(isObj).map((x) => ({
    id: str(x['id']),
    question: str(x['question']),
    answer: str(x['answer']),
  }))
}

function mergeResume(v: unknown): StoredResume | null {
  if (!isObj(v) || typeof v['fileName'] !== 'string') return null
  return { fileName: str(v['fileName']), storedPath: str(v['storedPath']), text: str(v['text']), updatedAt: str(v['updatedAt']) }
}

/** Track ids end up in file names, so they are kept to letters, digits, '-' and '_'. */
export const TRACK_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Drops entries without a usable id (and repeats of one), fills in missing fields. */
function mergeTracks(v: unknown): ApplicationTrack[] {
  const seen = new Set<string>()
  const out: ApplicationTrack[] = []
  for (const t of Array.isArray(v) ? v : []) {
    if (!isObj(t)) continue
    const id = str(t['id']).trim()
    if (!TRACK_ID.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: str(t['name']).trim() || 'Untitled track',
      description: str(t['description']),
      resume: mergeResume(t['resume']),
      targetRoles: strList(t['targetRoles']),
      keywords: strList(t['keywords']),
      answers: mergeAnswers(t['answers']),
    })
  }
  return out
}

/** Adds https:// to a bare link like "github.com/alex". Leaves '' alone. */
export function normalizeLink(v: string): string {
  const t = v.trim()
  if (!t) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`
}

const cleanList = (xs: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const t = x.trim()
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase())
      out.push(t)
    }
  }
  return out
}

let idCounter = 0
const newId = () => `a${Date.now().toString(36)}${(idCounter++).toString(36)}`
/** A fresh track id, safe to use in a file name. */
export const newTrackId = () => `t${Date.now().toString(36)}${(idCounter++).toString(36)}`

const cleanAnswers = (answers: SavedAnswer[]): SavedAnswer[] =>
  answers.map((a) => ({ id: a.id || newId(), question: a.question.trim(), answer: a.answer.trim() })).filter((a) => a.question || a.answer)

/** Trims a track's text and chips and drops empty answer rows. */
export function normalizeTrack(t: ApplicationTrack): ApplicationTrack {
  return {
    ...t,
    name: t.name.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Untitled track',
    description: t.description.trim().slice(0, 400),
    targetRoles: cleanList(t.targetRoles),
    keywords: cleanList(t.keywords),
    answers: cleanAnswers(t.answers),
  }
}

/** Trims text, completes links, drops empty rows and duplicate chips. */
export function normalizeProfile(input: Profile): Profile {
  const p = mergeWithDefaults(input)
  const t = (s: string) => s.trim()
  return {
    ...p,
    legalFirstName: t(p.legalFirstName),
    legalLastName: t(p.legalLastName),
    preferredName: t(p.preferredName),
    email: t(p.email),
    phone: t(p.phone),
    city: t(p.city),
    region: t(p.region),
    country: t(p.country),
    linkedin: normalizeLink(p.linkedin),
    github: normalizeLink(p.github),
    website: normalizeLink(p.website),
    scholar: normalizeLink(p.scholar),
    education: p.education
      .map((e) => ({ school: t(e.school), degree: t(e.degree), field: t(e.field), startDate: t(e.startDate), endDate: t(e.endDate), gpa: t(e.gpa) }))
      .filter((e) => Object.values(e).some(Boolean)),
    demographics: { ...p.demographics, pronouns: t(p.demographics.pronouns) },
    preferences: {
      ...p.preferences,
      targetRoles: cleanList(p.preferences.targetRoles),
      locations: cleanList(p.preferences.locations),
      keywords: cleanList(p.preferences.keywords),
      excludeKeywords: cleanList(p.preferences.excludeKeywords),
      term: t(p.preferences.term),
      minPay: t(p.preferences.minPay),
      notes: p.preferences.notes.trim(),
    },
    answers: cleanAnswers(p.answers),
    tracks: p.tracks.map(normalizeTrack),
  }
}

/** Field path ("email", "education.0.gpa", "answers.2.question") -> readable message. */
export type ProfileErrors = Record<string, string>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

function checkLink(v: string, host: RegExp | null, label: string, example: string): string | null {
  if (!v.trim()) return null
  let url: URL
  try {
    url = new URL(normalizeLink(v))
  } catch {
    return `That doesn't look like a link. Try ${example}.`
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Links need to start with https://.'
  if (!url.hostname.includes('.')) return `That doesn't look like a link. Try ${example}.`
  if (host && !host.test(url.hostname)) return `This should be a ${label} link, like ${example}.`
  return null
}

/** Checks the obvious things. Empty fields are always fine: every field is optional. */
export function validateProfile(p: Profile): ProfileErrors {
  const errors: ProfileErrors = {}
  const set = (k: string, msg: string | null) => {
    if (msg) errors[k] = msg
  }
  if (p.email.trim() && !EMAIL.test(p.email.trim())) set('email', 'Enter an email address like name@example.com.')
  if (p.phone.trim()) {
    const digits = p.phone.replace(/\D/g, '').length
    if (/[^\d\s()+.\-x]/i.test(p.phone.trim())) set('phone', 'Use digits, spaces and + ( ) - only.')
    else if (digits < 7 || digits > 15) set('phone', 'Phone numbers have 7 to 15 digits.')
  }
  set('linkedin', checkLink(p.linkedin, /(^|\.)linkedin\.com$/i, 'LinkedIn', 'linkedin.com/in/your-name'))
  set('github', checkLink(p.github, /(^|\.)github\.com$/i, 'GitHub', 'github.com/your-name'))
  set('website', checkLink(p.website, null, '', 'yourname.dev'))
  set('scholar', checkLink(p.scholar, /^scholar\.google\./i, 'Google Scholar', 'scholar.google.com/citations?user=…'))
  p.education.forEach((e, i) => {
    const any = Object.values(e).some((v) => v.trim())
    if (any && !e.school.trim()) set(`education.${i}.school`, 'Add the school name, or remove this entry.')
    if (e.startDate && !MONTH.test(e.startDate)) set(`education.${i}.startDate`, 'Use a month and year.')
    if (e.endDate && !MONTH.test(e.endDate)) set(`education.${i}.endDate`, 'Use a month and year.')
    if (MONTH.test(e.startDate) && MONTH.test(e.endDate) && e.endDate < e.startDate)
      set(`education.${i}.endDate`, 'The end date is before the start date.')
    if (e.gpa.trim()) {
      const m = /^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/.exec(e.gpa.trim())
      const value = m ? Number(m[1]) : NaN
      const scale = m?.[2] ? Number(m[2]) : null
      if (!m) set(`education.${i}.gpa`, 'Write the GPA as a number, like 3.8 or 3.8/4.0.')
      else if (scale !== null ? value > scale : value > 5) set(`education.${i}.gpa`, 'That GPA is higher than the scale allows.')
    }
  })
  p.answers.forEach((a, i) => {
    if (a.answer.trim() && !a.question.trim()) set(`answers.${i}.question`, 'Add the question this answers.')
  })
  p.tracks.forEach((t, i) => {
    for (const [k, v] of Object.entries(validateTrack(t))) set(`tracks.${i}.${k}`, v)
  })
  return errors
}

/** Field path within the track ("answers.0.question") -> message. */
export function validateTrack(t: ApplicationTrack): ProfileErrors {
  const errors: ProfileErrors = {}
  t.answers.forEach((a, i) => {
    if (a.answer.trim() && !a.question.trim()) errors[`answers.${i}.question`] = 'Add the question this answers.'
  })
  return errors
}

/** One readable sentence for an error list, used by the main process when refusing a save. */
export function describeErrors(errors: ProfileErrors): string {
  const msgs = Object.values(errors)
  if (!msgs.length) return ''
  return msgs.length === 1 ? msgs[0]! : `${msgs.length} fields need attention. First: ${msgs[0]}`
}

/** "Alex" from preferred name, else legal first name. */
export function displayName(p: Profile): string {
  const first = p.preferredName.trim() || p.legalFirstName.trim()
  return [first, p.legalLastName.trim()].filter(Boolean).join(' ')
}
