/** "Add from a link": read a posting through its board API or its page, then let the AI fill the rest. */
import { FITS, type Fit, type RoleInput } from '@shared/roles'
import { DEGREE_LEVELS, ROLE_TYPES, effectiveDegreeLevel, roleTypesOf, type Profile } from '@shared/profile'
import type { RoleDraft } from '@shared/search'
import type { AiService } from '../ai/service'
import { boardName, fetchPosting, parsePostingUrl, type JobPosting } from './boards'
import { HttpError, getText, hostOf } from './http'
import { extractJsonLdJob, htmlToText, metaContent, pageTitle, payFromText } from './html'

export const NO_AI_WARNING = 'Connect an AI provider in Settings to fill in fit and details.'

export interface PostingRead {
  url: string
  /** Facts printed on the posting, from the board API or JSON-LD. Blank when not printed. */
  facts: { company: string; title: string; location: string; pay: string; deadline: string }
  /** Weaker hints from the page's title tags, used only when nothing better is found. */
  hints: { company: string; title: string }
  text: string
  source: 'board' | 'page'
}

/** True when the profile says enough about the person to judge fit. */
export function hasProfileContent(p: Profile): boolean {
  const pr = p.preferences
  return Boolean(
    p.resume?.text?.trim() ||
      p.education.length ||
      pr.targetRoles.length ||
      pr.keywords.length ||
      pr.notes.trim() ||
      pr.term.trim(),
  )
}

/** What the AI sees about the person: preferences, education and resume text. Never contact or demographic details. */
export function profileForAi(p: Profile, resumeChars = 8000): string {
  const pr = p.preferences
  const degree = effectiveDegreeLevel(p)
  const lines = [
    `Looking for: ${roleTypesOf(pr.roleTypes).map((t) => ROLE_TYPES.find((r) => r.value === t)!.label.toLowerCase()).join(', ')}`,
    degree && `Degree level (has or is working toward): ${DEGREE_LEVELS.find((d) => d.value === degree)!.label}`,
    pr.targetRoles.length && `Target roles: ${pr.targetRoles.join('; ')}`,
    pr.term && `Term: ${pr.term}`,
    pr.locations.length && `Locations: ${pr.locations.join('; ')}${pr.remoteOk ? ' (remote is fine)' : ''}`,
    pr.minPay && `Minimum pay: ${pr.minPay}`,
    pr.keywords.length && `Interested in: ${pr.keywords.join(', ')}`,
    pr.excludeKeywords.length && `Not interested in: ${pr.excludeKeywords.join(', ')}`,
    pr.notes && `Notes: ${pr.notes}`,
    p.education.length &&
      `Education: ${p.education.map((e) => [e.degree, e.field, e.school, e.endDate && `(ends ${e.endDate})`].filter(Boolean).join(' ')).join('; ')}`,
    p.authorizedToWorkUS != null && `Authorized to work in the US: ${p.authorizedToWorkUS ? 'yes' : 'no'}`,
    p.needsSponsorship != null && `Needs sponsorship: ${p.needsSponsorship ? 'yes' : 'no'}`,
    p.resume?.text?.trim() && `Resume:\n${p.resume.text.trim().slice(0, resumeChars)}`,
  ]
  return lines.filter(Boolean).join('\n')
}

function fromPosting(p: JobPosting): PostingRead {
  return {
    url: p.url,
    facts: { company: p.company, title: p.title, location: p.location, pay: p.compensation, deadline: p.deadline },
    hints: { company: '', title: '' },
    text: p.description.slice(0, 20_000),
    source: 'board',
  }
}

/** Reads a posting. Board links go through the board API; anything else is fetched and read as a page. */
export async function readPosting(url: string, signal?: AbortSignal): Promise<PostingRead> {
  const ref = parsePostingUrl(url)
  if (ref) {
    try {
      const posting = await fetchPosting(ref, { pageUrl: url, signal })
      if (!posting) throw new Error('The job board no longer lists this posting. It may have closed.')
      // Ashby and Lever don't name the company in the posting; their board page does.
      if (ref.board !== 'greenhouse' && ref.slug) posting.company = await boardName({ board: ref.board, slug: ref.slug, eu: ref.eu }, { signal })
      return fromPosting(posting)
    } catch (err) {
      // An embedded link whose board we couldn't find: fall back to reading the page.
      if (ref.slug) throw err
    }
  }

  let page: { text: string; url: string; type: string }
  try {
    page = await getText(url, { signal, timeoutMs: 20_000 })
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 410)) throw new Error("That page doesn't exist anymore. The posting may have closed.")
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) throw new Error(`${hostOf(url)} doesn't let apps read its pages. Fill in the role by hand.`)
    throw err
  }
  if (page.type && !/html|text\/plain|xml/i.test(page.type)) throw new Error("That link isn't a web page the app can read.")

  const ld = extractJsonLdJob(page.text)
  const text = htmlToText(page.text, 20_000)
  const ogTitle = metaContent(page.text, 'og:title') || pageTitle(page.text)
  const site = metaContent(page.text, 'og:site_name')
  return {
    url: page.url || url,
    facts: {
      company: ld?.company ?? '',
      title: ld?.title ?? '',
      location: ld?.location ?? '',
      pay: ld?.pay || payFromText(text),
      deadline: ld?.deadline ?? '',
    },
    hints: { company: site, title: ogTitle },
    text: ld?.description && text.length < 400 ? ld.description : text,
    source: 'page',
  }
}

interface AiFill {
  company?: string
  title?: string
  location?: string
  pay?: string
  deadline?: string
  fit?: string
  why?: string
  watch?: string
  postingStatus?: string
}

const SYSTEM = `You read job postings for an internship tracker and return one JSON object. Only report what the posting text actually says; use "" when it doesn't say. Never guess.
Fields:
- company: the hiring company's name.
- title: the role title, without the company name.
- location: city/region as printed; add "or remote" only if the posting allows remote work.
- pay: the pay range as printed, short (e.g. "$45–55/hr", "$8k/mo"). "" if no pay is printed.
- deadline: application deadline as YYYY-MM-DD, only if a specific date is printed. Otherwise "".
- postingStatus: "Open", "Closed", or a short status the page prints (e.g. "Rolling until filled"). "" if unclear.
- fit: one of "Strong", "Good", "Moderate", "Weak" — how well the applicant matches. "" if no applicant profile is given.
- why: one or two sentences on why this role suits the applicant, citing concrete overlaps. "" if no profile.
- watch: one sentence on gaps, requirements or risks to check (e.g. grad date, sponsorship, location). "" if none or no profile.`

const clean = (v: unknown, max = 400) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Reads the posting at `url` and returns a draft role. Nothing is saved. */
export async function draftFromLink(url: string, deps: { ai: AiService; profile: () => Profile; signal?: AbortSignal }): Promise<RoleDraft> {
  const read = await readPosting(url, deps.signal)
  const role: RoleInput = { company: '', title: '', link: url, stage: 'saved' }
  const filled = new Set<string>()
  const put = (k: 'company' | 'title' | 'location' | 'pay' | 'deadline' | 'fit' | 'why' | 'watch' | 'postingStatus', v: string) => {
    if (!v) return
    ;(role as Record<string, unknown>)[k] = v
    filled.add(k)
  }
  for (const [k, v] of Object.entries(read.facts) as [keyof PostingRead['facts'], string][]) put(k, v)

  let warning = ''
  const profile = deps.profile()
  const withProfile = hasProfileContent(profile)
  try {
    const known = Object.entries(read.facts)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    const prompt = [
      `Posting URL: ${read.url}`,
      known && `Facts from the job board (treat as correct):\n${known}`,
      (read.hints.title || read.hints.company) && `Page title: ${[read.hints.title, read.hints.company].filter(Boolean).join(' · ')}`,
      `Posting text:\n${read.text || '(the page had no readable text)'}`,
      withProfile ? `Applicant profile:\n${profileForAi(profile)}` : 'No applicant profile is set up, so leave fit, why and watch blank.',
    ]
      .filter(Boolean)
      .join('\n\n')
    const out = await deps.ai.json<AiFill>({ system: SYSTEM, messages: [{ role: 'user', content: prompt }], json: true }, { signal: deps.signal })
    // Board facts win over the model for the fields they cover.
    if (!read.facts.company) put('company', clean(out.company, 80))
    if (!read.facts.title) put('title', clean(out.title, 140))
    if (!read.facts.location) put('location', clean(out.location, 120))
    if (!read.facts.pay) put('pay', clean(out.pay, 60))
    const dl = clean(out.deadline, 10)
    if (!read.facts.deadline && /^\d{4}-\d{2}-\d{2}$/.test(dl) && !Number.isNaN(new Date(dl).getTime())) put('deadline', dl)
    put('postingStatus', clean(out.postingStatus, 60))
    if (withProfile) {
      const fit = clean(out.fit, 10)
      const f = FITS.find((x) => x.toLowerCase() === fit.toLowerCase())
      if (f) put('fit', f as Fit)
      put('why', clean(out.why, 600))
      put('watch', clean(out.watch, 400))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warning = /no ai connection/i.test(msg) ? NO_AI_WARNING : `Read the posting, but the AI step failed: ${msg}`
  }

  if (!filled.has('company')) put('company', read.hints.company)
  if (!filled.has('title')) put('title', read.hints.title)
  if (!filled.size) warning = `Couldn't find role details on that page.${warning === NO_AI_WARNING ? ' ' + NO_AI_WARNING : ''} Fill them in by hand.`
  return { role, filled: [...filled], warning }
}
