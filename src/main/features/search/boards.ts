/** Public job-board APIs (Greenhouse, Ashby, Lever): URL parsing, clients and one normalized posting shape. */
import type { BoardKind } from '@shared/search'
import { HttpError, getJson, getText, type RequestOptions } from './http'
import { escapedHtmlToText, formatPay, htmlToText, isoDay, metaContent, pageTitle, payFromText } from './html'

export interface JobPosting {
  board: BoardKind
  id: string
  company: string
  title: string
  location: string
  url: string
  /** YYYY-MM-DD, or ''. */
  postedAt: string
  /** Pay as the board prints it, or ''. */
  compensation: string
  description: string
  department: string
  /** YYYY-MM-DD when the board lists an application deadline, or ''. */
  deadline: string
}

/** A specific posting on a known board. `slug` is null for embedded links (?gh_jid=) until resolved. */
export interface PostingRef {
  board: BoardKind
  slug: string | null
  id: string
  /** Lever has an EU instance with its own API host. */
  eu?: boolean
}

export interface BoardRef {
  board: BoardKind
  slug: string
  eu?: boolean
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toUrl(input: string): URL | null {
  const s = input.trim()
  if (!s) return null
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
}

const parts = (u: URL) => u.pathname.split('/').filter(Boolean).map(decodeURIComponent)

/** Recognizes a link to one posting on Greenhouse, Ashby or Lever, including embedded ?gh_jid= / ?ashby_jid= links. */
export function parsePostingUrl(input: string): PostingRef | null {
  const u = toUrl(input)
  if (!u) return null
  const host = u.hostname.toLowerCase()
  const p = parts(u)

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // boards.greenhouse.io/embed/job_app?for=acme&token=123
    if (p[0] === 'embed') {
      const slug = u.searchParams.get('for')
      const id = u.searchParams.get('token') ?? u.searchParams.get('gh_jid')
      return slug && id && /^\d+$/.test(id) ? { board: 'greenhouse', slug, id } : null
    }
    // boards-api.greenhouse.io/v1/boards/acme/jobs/123
    if (host.startsWith('boards-api.') && p[0] === 'v1' && p[1] === 'boards' && p[3] === 'jobs' && p[4] && /^\d+$/.test(p[4]))
      return { board: 'greenhouse', slug: p[2]!, id: p[4] }
    // job-boards.greenhouse.io/acme/jobs/123, boards.greenhouse.io/acme/jobs/123
    if (p.length >= 3 && p[1] === 'jobs' && /^\d+$/.test(p[2]!) && SLUG.test(p[0]!)) return { board: 'greenhouse', slug: p[0]!, id: p[2]! }
    const jid = u.searchParams.get('gh_jid')
    if (p[0] && SLUG.test(p[0]) && jid && /^\d+$/.test(jid)) return { board: 'greenhouse', slug: p[0], id: jid }
    return null
  }

  if (host === 'jobs.ashbyhq.com') {
    if (p.length >= 2 && UUID.test(p[1]!)) return { board: 'ashby', slug: p[0]!, id: p[1]!.toLowerCase() }
    return null
  }

  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    if (p.length >= 2 && UUID.test(p[1]!)) return { board: 'lever', slug: p[0]!, id: p[1]!.toLowerCase(), eu: host.includes('.eu.') }
    return null
  }

  // A company's own careers page with an embedded board.
  const gh = u.searchParams.get('gh_jid')
  if (gh && /^\d+$/.test(gh)) return { board: 'greenhouse', slug: null, id: gh }
  const ash = u.searchParams.get('ashby_jid')
  if (ash && UUID.test(ash)) return { board: 'ashby', slug: null, id: ash.toLowerCase() }
  return null
}

/** Recognizes a board's own URL (or any posting on it): job-boards.greenhouse.io/acme, jobs.ashbyhq.com/acme, jobs.lever.co/acme. */
export function parseBoardUrl(input: string): BoardRef | null {
  const posting = parsePostingUrl(input)
  if (posting?.slug) return { board: posting.board, slug: posting.slug, ...(posting.eu ? { eu: true } : {}) }
  const u = toUrl(input)
  if (!u) return null
  const host = u.hostname.toLowerCase()
  const p = parts(u)
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (p[0] === 'embed') {
      const slug = u.searchParams.get('for')
      return slug && SLUG.test(slug) ? { board: 'greenhouse', slug } : null
    }
    if (host.startsWith('boards-api.') && p[0] === 'v1' && p[1] === 'boards' && p[2]) return { board: 'greenhouse', slug: p[2] }
    return p[0] && SLUG.test(p[0]) ? { board: 'greenhouse', slug: p[0] } : null
  }
  if (host === 'jobs.ashbyhq.com') return p[0] && SLUG.test(p[0]) ? { board: 'ashby', slug: p[0] } : null
  if (host === 'api.ashbyhq.com' && p[0] === 'posting-api' && p[1] === 'job-board' && p[2]) return { board: 'ashby', slug: p[2] }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co')
    return p[0] && SLUG.test(p[0]) ? { board: 'lever', slug: p[0], ...(host.includes('.eu.') ? { eu: true } : {}) } : null
  if ((host === 'api.lever.co' || host === 'api.eu.lever.co') && p[0] === 'v0' && p[1] === 'postings' && p[2])
    return { board: 'lever', slug: p[2], ...(host.includes('.eu.') ? { eu: true } : {}) }
  return null
}

/** Finds a board embedded in a company's careers page HTML. */
export function findBoardInHtml(html: string): BoardRef | null {
  const gh =
    /greenhouse\.io\/embed\/job_(?:board|app)(?:\/js)?\?(?:[^"'\s>]*&(?:amp;)?)?for=([A-Za-z0-9._-]+)/i.exec(html) ??
    /(?:job-boards|boards)\.greenhouse\.io\/(?!embed\b)([A-Za-z0-9._-]+)/i.exec(html) ??
    /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9._-]+)/i.exec(html)
  if (gh) return { board: 'greenhouse', slug: gh[1]! }
  const ash = /jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/i.exec(html) ?? /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9._-]+)/i.exec(html)
  if (ash && ash[1] !== 'api') return { board: 'ashby', slug: ash[1]! }
  const lever = /jobs\.(eu\.)?lever\.co\/([A-Za-z0-9._-]+)/i.exec(html)
  if (lever) return { board: 'lever', slug: lever[2]!, ...(lever[1] ? { eu: true } : {}) }
  return null
}

const enc = encodeURIComponent
const leverApi = (eu?: boolean) => (eu ? 'https://api.eu.lever.co' : 'https://api.lever.co')
const BOARD_TIMEOUT = 30_000

export function titleizeSlug(slug: string): string {
  return slug
    .replace(/[-_.]+/g, ' ')
    .replace(/\b(ai|ml|io)\b/gi, (m) => m.toUpperCase())
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim()
}

// ---------- Greenhouse ----------

interface GhJob {
  id: number
  title: string
  absolute_url: string
  location?: { name?: string } | null
  company_name?: string
  first_published?: string | null
  updated_at?: string | null
  application_deadline?: string | null
  content?: string
  departments?: { name: string }[]
  pay_input_ranges?: { min_cents?: number; max_cents?: number; currency_type?: string; title?: string; blurb?: string }[]
}

function ghPay(j: GhJob, text: string): string {
  const r = j.pay_input_ranges?.[0]
  if (r && (r.min_cents || r.max_cents)) {
    const interval = /hour/i.test(r.title ?? '') ? 'hour' : /month/i.test(r.title ?? '') ? 'month' : /week/i.test(r.title ?? '') ? 'week' : /year|annual|salary/i.test(r.title ?? '') ? 'year' : ''
    return formatPay(r.min_cents ? r.min_cents / 100 : null, r.max_cents ? r.max_cents / 100 : null, r.currency_type ?? 'USD', interval)
  }
  return payFromText(text)
}

export function normalizeGreenhouse(j: GhJob, company: string): JobPosting {
  const description = j.content ? escapedHtmlToText(j.content, 12_000) : ''
  return {
    board: 'greenhouse',
    id: String(j.id),
    company: j.company_name?.trim() || company,
    title: j.title.trim(),
    location: j.location?.name?.trim() ?? '',
    url: j.absolute_url,
    postedAt: isoDay(j.first_published ?? j.updated_at ?? ''),
    compensation: ghPay(j, description),
    description,
    department: (j.departments ?? []).map((d) => d.name).join(', '),
    deadline: isoDay(j.application_deadline ?? ''),
  }
}

// ---------- Ashby ----------

interface AshbyJob {
  id: string
  title: string
  department?: string
  team?: string
  location?: string
  secondaryLocations?: { location?: string }[]
  isRemote?: boolean
  workplaceType?: string
  publishedAt?: string
  jobUrl: string
  descriptionPlain?: string
  descriptionHtml?: string
  isListed?: boolean
  compensation?: {
    compensationTierSummary?: string | null
    scrapeableCompensationSalarySummary?: string | null
  } | null
}

export function normalizeAshby(j: AshbyJob, company: string): JobPosting {
  const locs = [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter((x): x is string => !!x?.trim())
  let location = [...new Set(locs)].join('; ')
  if (j.isRemote && !/remote/i.test(location)) location = location ? `${location} or remote` : 'Remote'
  const description = j.descriptionPlain?.trim() ? j.descriptionPlain.trim().slice(0, 12_000) : j.descriptionHtml ? htmlToText(j.descriptionHtml, 12_000) : ''
  const comp = j.compensation?.compensationTierSummary?.trim() || j.compensation?.scrapeableCompensationSalarySummary?.trim() || ''
  return {
    board: 'ashby',
    id: j.id.toLowerCase(),
    company,
    title: j.title.trim(),
    location,
    url: j.jobUrl,
    postedAt: isoDay(j.publishedAt ?? ''),
    compensation: comp || payFromText(description),
    description,
    department: [j.department, j.team].filter((x, i, a) => x && a.indexOf(x) === i).join(', '),
    deadline: '',
  }
}

// ---------- Lever ----------

interface LeverJob {
  id: string
  text: string
  hostedUrl: string
  createdAt?: number
  categories?: { location?: string; allLocations?: string[]; team?: string; department?: string; commitment?: string }
  workplaceType?: string
  descriptionPlain?: string
  additionalPlain?: string
  lists?: { text: string; content: string }[]
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } | null
}

export function normalizeLever(j: LeverJob, company: string): JobPosting {
  const c = j.categories ?? {}
  let location = (c.allLocations?.length ? c.allLocations.join('; ') : c.location) ?? ''
  if (j.workplaceType === 'remote' && !/remote/i.test(location)) location = location ? `${location} or remote` : 'Remote'
  const lists = (j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content, 4000)}`).join('\n\n')
  const description = [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n\n').trim().slice(0, 12_000)
  const s = j.salaryRange
  return {
    board: 'lever',
    id: j.id.toLowerCase(),
    company,
    title: j.text.trim(),
    location,
    url: j.hostedUrl,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : '',
    compensation: (s ? formatPay(s.min, s.max, s.currency ?? 'USD', s.interval ?? '') : '') || payFromText(description),
    description,
    department: [c.department, c.team, c.commitment].filter(Boolean).join(', '),
    deadline: '',
  }
}

// ---------- Clients ----------

/** Every open posting on a board. Throws HttpError(404) when the board doesn't exist. */
export async function fetchBoard(ref: BoardRef, company: string, opts: RequestOptions = {}): Promise<JobPosting[]> {
  const o = { timeoutMs: BOARD_TIMEOUT, ...opts }
  if (ref.board === 'greenhouse') {
    const d = await getJson<{ jobs: GhJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${enc(ref.slug)}/jobs?content=true`, o)
    return (d.jobs ?? []).map((j) => normalizeGreenhouse(j, company))
  }
  if (ref.board === 'ashby') {
    const d = await getJson<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${enc(ref.slug)}?includeCompensation=true`, o)
    return (d.jobs ?? []).filter((j) => j.isListed !== false).map((j) => normalizeAshby(j, company))
  }
  const d = await getJson<LeverJob[]>(`${leverApi(ref.eu)}/v0/postings/${enc(ref.slug)}?mode=json`, o)
  return (Array.isArray(d) ? d : []).map((j) => normalizeLever(j, company))
}

/** Display name for a board, from the board itself where it says. Falls back to the slug. */
export async function boardName(ref: BoardRef, opts: RequestOptions = {}): Promise<string> {
  try {
    if (ref.board === 'greenhouse') {
      const d = await getJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${enc(ref.slug)}`, opts)
      if (d.name?.trim()) return d.name.trim()
    } else {
      const page = ref.board === 'ashby' ? `https://jobs.ashbyhq.com/${enc(ref.slug)}` : `https://jobs.${ref.eu ? 'eu.' : ''}lever.co/${enc(ref.slug)}`
      const { text } = await getText(page, opts)
      const t = (metaContent(text, 'og:title') || pageTitle(text)).replace(/\s*(?:[-|–]\s*)?(?:Jobs|Careers|Job Board)\s*$/i, '').trim()
      if (t && t.length <= 60) return t
    }
  } catch {
    /* fall through */
  }
  return titleizeSlug(ref.slug)
}

/** Looks for a Greenhouse token or Ashby org on the page an embedded link points to, then by the site's own name. */
async function resolveSlug(ref: PostingRef, pageUrl: string, opts: RequestOptions): Promise<string | null> {
  try {
    const { text } = await getText(pageUrl, opts)
    const found = findBoardInHtml(text)
    if (found && found.board === ref.board) return found.slug
  } catch {
    /* try the domain name next */
  }
  return siteLabel(pageUrl)
}

/** A company's name as its domain spells it: "https://careers.acme.co.uk/jobs" → "acme". */
export function siteLabel(url: string): string | null {
  try {
    const parts = new URL(url).hostname.toLowerCase().split('.').filter((p) => !/^(www|careers|jobs|job|about|apply|work)$/.test(p))
    if (parts.length >= 3 && /^(co|com|org|net|ac|gov|edu)$/.test(parts[parts.length - 2]!)) parts.pop()
    const label = parts.length >= 2 ? parts[parts.length - 2]! : null
    return label && /^[a-z0-9][a-z0-9-]*$/.test(label) ? label : null
  } catch {
    return null
  }
}

/**
 * One posting from its board API. Returns null when the board no longer lists it.
 * Throws when the board itself can't be found or read.
 */
export async function fetchPosting(ref: PostingRef, opts: RequestOptions & { pageUrl?: string; boardCache?: Map<string, Promise<JobPosting[]>> } = {}): Promise<JobPosting | null> {
  let slug = ref.slug
  if (!slug && opts.pageUrl) slug = await resolveSlug(ref, opts.pageUrl, opts)
  if (!slug) throw new Error("Couldn't tell which job board this page uses.")
  const board: BoardRef = { board: ref.board, slug, ...(ref.eu ? { eu: true } : {}) }

  if (ref.board === 'greenhouse') {
    try {
      const j = await getJson<GhJob>(`https://boards-api.greenhouse.io/v1/boards/${enc(slug)}/jobs/${enc(ref.id)}?pay_transparency=true`, opts)
      return normalizeGreenhouse(j, titleizeSlug(slug))
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err
      // A missing job and a missing board both answer 404; tell them apart.
      try {
        await getJson(`https://boards-api.greenhouse.io/v1/boards/${enc(slug)}`, opts)
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) throw new Error(`No Greenhouse board named "${slug}".`)
        throw e
      }
      return null
    }
  }

  if (ref.board === 'lever') {
    try {
      const j = await getJson<LeverJob>(`${leverApi(ref.eu)}/v0/postings/${enc(slug)}/${enc(ref.id)}`, opts)
      return normalizeLever(j, titleizeSlug(slug))
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        try {
          await getJson(`${leverApi(ref.eu)}/v0/postings/${enc(slug)}?mode=json&limit=1`, opts)
        } catch (e) {
          if (e instanceof HttpError && e.status === 404) throw new Error(`No Lever board named "${slug}".`)
          throw e
        }
        return null
      }
      throw err
    }
  }

  // Ashby has no single-posting endpoint; read the board and look for the id.
  const key = `ashby:${slug}`
  let list = opts.boardCache?.get(key)
  if (!list) {
    list = fetchBoard(board, titleizeSlug(slug), opts).catch((e) => {
      if (e instanceof HttpError && e.status === 404) throw new Error(`No Ashby board named "${slug}".`)
      throw e
    })
    opts.boardCache?.set(key, list)
  }
  return (await list).find((p) => p.id === ref.id) ?? null
}
