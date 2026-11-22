/**
 * Workday careers sites through their public job-search JSON (the same calls the careers page makes):
 *   POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs   { searchText, limit, offset }
 *   GET  https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job/{path}
 *
 * A watchlist entry stores the site as slug "{tenant}.wd{N}/{site}", e.g. "kestrel.wd5/KestrelCareers".
 * Workday pages hold at most 20 results and only the first page carries `total`.
 * To stay polite, every call to one host goes through a limiter that allows two at a time.
 */
import type { JobPosting } from './boards'
import { CancelledError, HttpError, USER_AGENT, hostOf, type RequestOptions } from './http'
import { htmlToText, isoDay, payFromText } from './html'

export interface WorkdaySite {
  tenant: string
  /** Data-center number from the host, e.g. 5 in kestrel.wd5.myworkdayjobs.com. */
  dc: number
  site: string
}

export interface WorkdayPostingRef extends WorkdaySite {
  /** Path after /job/, e.g. "US-CA-Santa-Clara/Hardware-Intern_JR123". */
  path: string
}

const HOST_RE = /^([a-z0-9][a-z0-9-]*)\.wd(\d{1,3})\.myworkdayjobs\.com$/i
const SITE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const LOCALE_RE = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/

export const workdaySlug = (s: WorkdaySite) => `${s.tenant}.wd${s.dc}/${s.site}`
export const workdayHost = (s: Pick<WorkdaySite, 'tenant' | 'dc'>) => `${s.tenant}.wd${s.dc}.myworkdayjobs.com`
export const workdaySiteUrl = (s: WorkdaySite) => `https://${workdayHost(s)}/${s.site}`
const apiBase = (s: WorkdaySite) => `https://${workdayHost(s)}/wday/cxs/${encodeURIComponent(s.tenant)}/${encodeURIComponent(s.site)}`
const encPath = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/')

/** "kestrel.wd5/KestrelCareers" → site. */
export function parseWorkdaySlug(slug: string): WorkdaySite | null {
  const m = /^([a-z0-9][a-z0-9-]*)\.wd(\d{1,3})\/([A-Za-z0-9][A-Za-z0-9_-]*)$/i.exec(slug.trim())
  return m ? { tenant: m[1]!.toLowerCase(), dc: Number(m[2]), site: m[3]! } : null
}

function toUrl(input: string): URL | null {
  const s = input.trim()
  if (!s) return null
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
}

/**
 * Reads a Workday careers URL: https://{tenant}.wd{N}.myworkdayjobs.com/[en-US/]{site}[/job/...|/details/...],
 * and the API form .../wday/cxs/{tenant}/{site}/... Returns the site and, for a posting, its path.
 */
export function parseWorkdayUrl(input: string): (WorkdaySite & { path: string | null }) | null {
  const u = toUrl(input)
  if (!u) return null
  const m = HOST_RE.exec(u.hostname.toLowerCase())
  if (!m) return null
  const tenant = m[1]!
  const dc = Number(m[2])
  let p: string[]
  try {
    p = u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
  if (p[0] === 'wday' && p[1] === 'cxs' && p[2] && p[3]) {
    const site = p[3]
    if (!SITE_RE.test(site)) return null
    const path = p[4] === 'job' && p.length > 5 ? p.slice(5).join('/') : null
    return { tenant: p[2].toLowerCase(), dc, site, path }
  }
  if (p[0] && LOCALE_RE.test(p[0]) && p[1]) p = p.slice(1)
  const site = p[0]
  if (!site || !SITE_RE.test(site) || /^(wday|login|job)$/i.test(site)) return null
  let path: string | null = null
  if ((p[1] === 'job' || p[1] === 'details') && p.length > 2) path = p[1] === 'details' ? p[p.length - 1]! : p.slice(2).join('/')
  return { tenant, dc, site, path }
}

// ---------- Politeness: at most two requests per host at once ----------

const PER_HOST = 2
const slots = new Map<string, { active: number; queue: (() => void)[] }>()

/** Runs fn while holding one of the host's two slots. Exported for tests. */
export async function withHostSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
  let s = slots.get(host)
  if (!s) slots.set(host, (s = { active: 0, queue: [] }))
  const slot = s
  if (slot.active >= PER_HOST) await new Promise<void>((resolve) => slot.queue.push(resolve))
  else slot.active++
  try {
    return await fn()
  } finally {
    const next = slot.queue.shift()
    if (next) next()
    else {
      slot.active--
      if (!slot.active) slots.delete(host)
    }
  }
}

async function call<T>(url: string, init: { method: 'GET' | 'POST'; body?: unknown }, opts: RequestOptions = {}): Promise<T> {
  return withHostSlot(hostOf(url), async () => {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    let res: Response
    try {
      res = await fetch(url, {
        method: init.method,
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          'Accept-Language': 'en-US,en;q=0.8',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      })
    } catch {
      if (opts.signal?.aborted) throw new CancelledError()
      if (timeout.aborted) throw new Error(`${hostOf(url)} took too long to answer.`)
      throw new Error(`Couldn't reach ${hostOf(url)}.`)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new HttpError(res.status, url, workdayError(res.status, url, text))
    }
    try {
      return (await res.json()) as T
    } catch {
      throw new Error(`${hostOf(url)} sent something that isn't JSON.`)
    }
  })
}

function workdayError(status: number, url: string, body: string): string {
  // Workday answers 422 when the site name is wrong and 404 when a posting is gone.
  if (status === 422) return `${hostOf(url)} has no careers site by that name.`
  if (status === 404 && /not found/i.test(body)) return `${hostOf(url)} doesn't list that posting.`
  return `${hostOf(url)} answered ${status}.`
}

// ---------- Shapes ----------

interface WdListItem {
  title?: string
  externalPath?: string
  locationsText?: string
  postedOn?: string
  bulletFields?: string[]
}
interface WdList {
  total?: number
  jobPostings?: WdListItem[]
}
interface WdDetail {
  jobPostingInfo?: {
    id?: string
    title?: string
    jobDescription?: string
    location?: string
    additionalLocations?: string[]
    postedOn?: string
    startDate?: string
    endDate?: string
    timeType?: string
    jobReqId?: string
    externalUrl?: string
    posted?: boolean
    canApply?: boolean
  }
  hiringOrganization?: { name?: string }
}

/** "Posted Today", "Posted Yesterday", "Posted 3 Days Ago" → YYYY-MM-DD; "30+ Days Ago" is too vague, so ''. */
export function postedOnToDay(text: string, now = new Date()): string {
  const t = text.toLowerCase()
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10)
  if (/\btoday\b/.test(t)) return day(0)
  if (/\byesterday\b/.test(t)) return day(1)
  const m = /(\d+)\s+days?\s+ago/.exec(t)
  if (m && !t.includes('+')) return day(Number(m[1]))
  return ''
}

const anchorOf = (path: string) => path.split('/').filter(Boolean).pop() ?? path

function fromListItem(s: WdListItem, site: WdSiteInfo, now: Date): JobPosting | null {
  if (!s.title || !s.externalPath) return null
  const path = s.externalPath.replace(/^\/?job\//, '')
  return {
    board: 'workday',
    id: anchorOf(path).toLowerCase(),
    company: site.company,
    title: s.title.trim(),
    location: s.locationsText?.trim() ?? '',
    url: `${workdaySiteUrl(site)}/job/${path}`,
    postedAt: postedOnToDay(s.postedOn ?? '', now),
    compensation: '',
    description: '',
    department: '',
    deadline: '',
  }
}

type WdSiteInfo = WorkdaySite & { company: string }

/** True when a detail answer says the posting is gone. */
export function detailSaysClosed(d: WdDetail | null | undefined): boolean {
  const info = d?.jobPostingInfo
  if (!info) return true
  if (info.posted === false) return true
  const text = `${info.title ?? ''} ${(info.jobDescription ?? '').slice(0, 600)}`
  return /no longer (?:available|accepting|open|posted)|(?:posting|position|job) (?:has been|is) (?:closed|filled|removed)/i.test(text)
}

export function normalizeWorkdayDetail(d: WdDetail, site: WdSiteInfo, path: string): JobPosting {
  const info = d.jobPostingInfo ?? {}
  const description = info.jobDescription ? htmlToText(info.jobDescription, 12_000) : ''
  const locs = [info.location, ...(info.additionalLocations ?? [])].filter((x): x is string => !!x?.trim())
  return {
    board: 'workday',
    id: anchorOf(path).toLowerCase(),
    company: site.company,
    title: (info.title ?? '').trim(),
    location: [...new Set(locs)].join('; '),
    url: info.externalUrl?.trim() || `${workdaySiteUrl(site)}/job/${path}`,
    postedAt: isoDay(info.startDate ?? '') || postedOnToDay(info.postedOn ?? ''),
    compensation: payFromText(description),
    description,
    department: info.timeType ?? '',
    deadline: isoDay(info.endDate ?? ''),
  }
}

// ---------- Client ----------

export const WORKDAY_PAGE = 20
export interface WorkdaySearch {
  /** Search phrases, e.g. ["intern", "photonics intern"]. Defaults to ["intern"]. */
  queries?: string[]
  /** Pages read per query (20 results each). */
  maxPages?: number
  /** Decides from the list entry (title, location) whether a posting is worth a detail call. */
  keep?: (p: JobPosting) => boolean
  /** Detail calls per site, best first in list order. */
  maxDetails?: number
}

/** One page of search results. */
export async function searchWorkday(site: WorkdaySite, searchText: string, offset: number, opts: RequestOptions = {}): Promise<WdList> {
  return call<WdList>(`${apiBase(site)}/jobs`, { method: 'POST', body: { appliedFacets: {}, limit: WORKDAY_PAGE, offset, searchText } }, opts)
}

/**
 * Searches a Workday site for each query, pages through the results (up to maxPages), keeps the ones `keep`
 * accepts, then reads up to maxDetails of them for descriptions. Postings whose detail call fails keep
 * their list fields; ones whose detail says they closed are dropped.
 */
export async function fetchWorkdayBoard(site: WorkdaySite, company: string, opts: RequestOptions & { search?: WorkdaySearch; now?: Date } = {}): Promise<JobPosting[]> {
  const { search = {} } = opts
  const info: WdSiteInfo = { ...site, company }
  const now = opts.now ?? new Date()
  const queries = [...new Set((search.queries?.length ? search.queries : ['intern']).map((q) => q.trim()).filter(Boolean))]
  const maxPages = search.maxPages ?? 5
  const found = new Map<string, JobPosting>()
  for (const q of queries) {
    let total = Infinity
    for (let page = 0; page < maxPages && page * WORKDAY_PAGE < total; page++) {
      const res = await searchWorkday(site, q, page * WORKDAY_PAGE, opts)
      // Only the first page says how many there are.
      if (page === 0) total = typeof res.total === 'number' ? res.total : Infinity
      const items = res.jobPostings ?? []
      for (const item of items) {
        const p = fromListItem(item, info, now)
        if (p && !found.has(p.id)) found.set(p.id, p)
      }
      if (items.length < WORKDAY_PAGE) break
    }
  }
  const kept = [...found.values()].filter((p) => (search.keep ? search.keep(p) : true)).slice(0, search.maxDetails ?? 25)
  const detailed = await Promise.all(
    kept.map(async (p) => {
      const path = p.url.slice(p.url.indexOf('/job/') + 5)
      try {
        const d = await fetchWorkdayDetail({ ...site, path }, company, opts)
        if (!d) return null
        return { ...d, url: p.url, location: d.location || p.location, postedAt: d.postedAt || p.postedAt, title: d.title || p.title }
      } catch {
        if (opts.signal?.aborted) throw new CancelledError()
        // Keep what the list said; the posting is still worth suggesting without its description.
        return p
      }
    }),
  )
  return detailed.filter((p): p is JobPosting => !!p)
}

/** One posting. Null when Workday says it is gone (404/410, or no longer posted). */
export async function fetchWorkdayDetail(ref: WorkdayPostingRef, company: string, opts: RequestOptions = {}): Promise<JobPosting | null> {
  let d: WdDetail
  try {
    d = await call<WdDetail>(`${apiBase(ref)}/job/${encPath(ref.path)}`, { method: 'GET' }, opts)
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 410)) {
      // A missing posting and a missing site both answer 404 here; tell them apart.
      if (!(await workdaySiteExists(ref, opts))) throw new Error(`No Workday careers site "${ref.site}" at ${workdayHost(ref)}.`)
      return null
    }
    throw err
  }
  if (detailSaysClosed(d)) return null
  return normalizeWorkdayDetail(d, { ...ref, company }, ref.path)
}

/** True when the site answers a one-result search. False for 404/422 (no such tenant or site). */
export async function workdaySiteExists(site: WorkdaySite, opts: RequestOptions = {}): Promise<boolean> {
  try {
    await call<WdList>(`${apiBase(site)}/jobs`, { method: 'POST', body: { appliedFacets: {}, limit: 1, offset: 0, searchText: '' } }, opts)
    return true
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 422)) return false
    throw err
  }
}

/** Company name for a Workday site: a known name, else the tenant spelled nicely. */
export function workdayCompanyName(site: Pick<WorkdaySite, 'tenant'>, known?: string): string {
  if (known) return known
  const t = site.tenant.replace(/[-_]+/g, ' ')
  return t.length <= 4 ? t.toUpperCase() : t.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}
