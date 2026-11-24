/**
 * Degree eligibility: does a posting only take students or graduates of a higher degree than the applicant's?
 *
 * It errs toward keeping postings. A posting is only ruled out when every sentence that states a degree
 * requirement asks for more than the applicant has: "BS, MS or PhD students" keeps a bachelor's student,
 * "PhD preferred" is ignored, and a sentence that allows "equivalent experience" lifts the requirement.
 */
import { DEGREE_RANK, type DegreeLevel } from '@shared/profile'
import type { JobPosting } from './boards'

/** Lookahead for bare "BS" / "MS" / "BA": only counts next to degree words, so "MS Office" doesn't. */
const NEAR = String.raw`(?=\s*(?:\/|,|\)|or\b|and\b|degree|in\b|students?|candidates?|programs?|level))`
/** "Master" without the 's only counts before a degree word: not "mastery", "Scrum Master" or "master data". */
const MASTER = String.raw`master(?:['’]?s\b|(?=\s+(?:of|degree|program|programme|students?|candidates?|thesis|in)\b))`

const LEVELS: [DegreeLevel, RegExp][] = [
  ['bachelors', new RegExp(String.raw`\b(?:bachelor(?:['’]?s)?\b|undergrad(?:uate)?s?\b|b\.\s?s\.?|b\.\s?a\.?|b\.?sc\b\.?|b\.?eng\b\.?|b\.?tech\b|new[- ]?grad\w*|recent grad\w*|college students?|honou?rs (?:degree|students?|level|or\b|,)|\(honou?rs|bs${NEAR}|ba${NEAR})`, 'i')],
  // "ms" right after a number is milliseconds ("under 5 ms and…").
  ['masters', new RegExp(String.raw`\b(?:${MASTER}|m\.\s?s\.?|m\.?sc\b\.?|m\.?eng\b\.?|mba\b|(?:post)?grad(?:uate)? students?|(?<!\d\s?)ms${NEAR})`, 'i')],
  ['phd', /\b(?:ph\.?\s?d\.?s?|doctoral|doctorate|d\.phil)\b/i],
]

/** Words that make a degree mention a requirement rather than a description of the team. */
const REQUIREMENT_CONTEXT =
  /\b(?:enrolled|enrol(?:l)?ing|pursuing|pursue|candidates?|students?|studying|degree|graduat\w*|programs?|must|required|requires?|requirements?|minimum|qualif\w*|eligib\w*|towards?|completed?|completing|holding|hold|currently|open to|in (?:a|an|the) [\w\s]{0,30}(?:program|field)|in (?:computer|electrical|physics|math|engineering|cs\b|ee\b|related))/i
/** "Ph.D. in EE", "Master's degree": a bare degree followed by a field also states a requirement. */
const DEGREE_IN = /\b(?:ph\.?\s?d|master|bachelor|b\.?s|m\.?s)\.?[’']?s?\s+(?:in|degree|of)\b/i
/**
 * A degree that describes the people around the role, not the applicant: "mentored by PhD researchers",
 * "work alongside PhDs in physics". Skipped unless the sentence also states a requirement outright.
 */
const TEAM = /\b(?:alongside|mentored by|mentorship from|led by|team of|teams of|surrounded by|learn from|work(?:ing)? (?:closely )?with|collaborat\w* with|join(?:ing)? (?:a|our) team of)\s+(?:[\w-]+\s+){0,4}?(?:ph\.?\s?d|doctoral|master|m\.?s\b)/i
const STRICT = /\b(?:must|required|requires?|minimum|eligib\w*|enrolled|pursuing|currently|open (?:only )?to|only)\b/i
/** Preferred, or only sometimes needed ("Some projects will require… Masters or PhD level"). */
const PREFERRED = /\b(?:prefer\w*|nice[- ]to[- ]have|bonus|ideal(?:ly)?|desir\w*|a plus|plus\b|helpful|advantage|some (?:projects|roles|teams|positions)|may require|might)/i
const EQUIVALENT = /\bequivalent\b[^.]{0,40}\b(?:experience|track record|background|qualifications?|skills|expertise)|\bor equivalent\b/i

/**
 * Sentences and bullet points of a description. A period followed by a lowercase word doesn't end a
 * sentence, so "Pursuing a Ph.D. or M.S. in EE" stays whole.
 */
function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?![a-z])|(?<=;)\s+|\s[•·▪●]\s/)
    .map((s) => s.replace(/^[\s•·▪●*-]+/, '').trim())
    .filter((s) => s.length > 2)
}

function levelsIn(s: string): DegreeLevel[] {
  return LEVELS.filter(([, re]) => re.test(s)).map(([l]) => l)
}

const lowest = (ls: DegreeLevel[]) => ls.reduce((a, b) => (DEGREE_RANK[b] < DEGREE_RANK[a] ? b : a))

export interface DegreeRequirement {
  level: DegreeLevel
  /** The sentence (or title) that states it, trimmed. */
  evidence: string
}

/** The lowest degree level the posting accepts, or null when it doesn't limit applicants by degree. */
export function requiredDegree(p: Pick<JobPosting, 'title' | 'description'>): DegreeRequirement | null {
  const found: DegreeRequirement[] = []
  const title = levelsIn(p.title)
  if (title.length) found.push({ level: lowest(title), evidence: p.title })
  for (const s of sentences(p.description)) {
    const ls = levelsIn(s)
    if (!ls.length || PREFERRED.test(s)) continue
    if (!REQUIREMENT_CONTEXT.test(s) && !DEGREE_IN.test(s)) continue
    if (TEAM.test(s) && !STRICT.test(s)) continue
    // "or equivalent experience" means the degree isn't required at all.
    if (EQUIVALENT.test(s)) return null
    found.push({ level: lowest(ls), evidence: s.length > 220 ? `${s.slice(0, 217)}…` : s })
  }
  if (!found.length) return null
  // The most permissive statement wins: one sentence welcoming bachelor's students keeps the posting.
  return found.reduce((a, b) => (DEGREE_RANK[b.level] < DEGREE_RANK[a.level] ? b : a))
}

const LEVEL_NAME: Record<DegreeLevel, string> = { bachelors: 'a bachelor’s', masters: 'a master’s', phd: 'a PhD' }

/**
 * Null when the applicant qualifies (or their level is unknown), else why not, quoting the posting.
 */
export function ineligibleReason(p: Pick<JobPosting, 'title' | 'description'>, level: DegreeLevel | null): string | null {
  if (!level) return null
  const req = requiredDegree(p)
  if (!req || DEGREE_RANK[level] >= DEGREE_RANK[req.level]) return null
  return `Asks for at least ${LEVEL_NAME[req.level]}: “${req.evidence}”`
}
