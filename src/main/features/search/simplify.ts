/**
 * The SimplifyJobs community internship list (github.com/SimplifyJobs/Summer2027-Internships).
 *
 * The repository has no license, so the app treats it only as a local index of links: it downloads
 * listings.json, keeps a trimmed copy of the active entries on this computer (never shared or uploaded),
 * and turns entries that fit the profile into postings for the usual filter → rank pipeline.
 * Re-downloads send If-None-Match, so an unchanged list costs one 304.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { JobPosting } from './boards'
import { parsePostingUrl } from './boards'
import { CancelledError, HttpError, USER_AGENT, hostOf } from './http'

export const SIMPLIFY_LISTINGS_URL = 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json'
/** The same community's list of new grad roles, read when the user looks for them. */
export const SIMPLIFY_NEWGRAD_URL = 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json'
export const SIMPLIFY_SOURCE_KEY = 'simplify'

/** One entry of listings.json, as far as the app reads it. */
export interface SimplifyListing {
  id?: string
  company_name?: string
  title?: string
  url?: string
  locations?: string[]
  terms?: string[]
  category?: string
  active?: boolean
  is_visible?: boolean
  /** Unix seconds. */
  date_posted?: number
  sponsorship?: string
}

/** The trimmed entry kept in the local cache. */
export interface CachedListing {
  id: string
  company: string
  title: string
  url: string
  locations: string[]
  terms: string[]
  category: string
  postedAt: string
  sponsorship: string
}

export interface SimplifyCache {
  etag: string
  fetchedAt: string
  items: CachedListing[]
}

/** Keeps active, visible entries with a link, trimmed to the fields the app uses. */
export function parseListings(raw: unknown): CachedListing[] {
  if (!Array.isArray(raw)) throw new Error("The SimplifyJobs list isn't in the expected format.")
  const out: CachedListing[] = []
  for (const r of raw as SimplifyListing[]) {
    if (!r || r.active !== true || r.is_visible === false) continue
    const url = typeof r.url === 'string' ? r.url.trim() : ''
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    const company = typeof r.company_name === 'string' ? r.company_name.trim() : ''
    if (!/^https?:\/\//i.test(url) || !title || !company) continue
    out.push({
      id: String(r.id ?? url),
      company,
      title,
      url,
      locations: Array.isArray(r.locations) ? r.locations.filter((l): l is string => typeof l === 'string' && !!l.trim()) : [],
      terms: Array.isArray(r.terms) ? r.terms.filter((t): t is string => typeof t === 'string' && !!t.trim() && t !== 'N/A') : [],
      category: typeof r.category === 'string' ? r.category : '',
      postedAt: typeof r.date_posted === 'number' && r.date_posted > 0 ? new Date(r.date_posted * 1000).toISOString().slice(0, 10) : '',
      sponsorship: typeof r.sponsorship === 'string' ? r.sponsorship : '',
    })
  }
  return out
}

export function readCache(file: string): SimplifyCache | null {
  try {
    if (!existsSync(file)) return null
    const c = JSON.parse(readFileSync(file, 'utf8')) as SimplifyCache
    return c && Array.isArray(c.items) && typeof c.etag === 'string' ? c : null
  } catch {
    return null
  }
}

function writeCache(file: string, cache: SimplifyCache): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(cache))
  renameSync(tmp, file)
}

/**
 * The current list: re-downloads only when GitHub says it changed (ETag). Falls back to the cached copy
 * when GitHub can't be reached, and says so through `stale`.
 */
export async function loadSimplifyListings(
  cacheFile: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; url?: string } = {},
): Promise<{ items: CachedListing[]; fromCache: boolean; stale: string }> {
  const url = opts.url ?? SIMPLIFY_LISTINGS_URL
  const cached = readCache(cacheFile)
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 60_000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  let res: Response
  try {
    res = await fetch(url, {
      signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
    })
  } catch {
    if (opts.signal?.aborted) throw new CancelledError()
    const why = timeout.aborted ? `${hostOf(url)} took too long to answer.` : `Couldn't reach ${hostOf(url)}.`
    if (cached) return { items: cached.items, fromCache: true, stale: why }
    throw new Error(why)
  }
  if (res.status === 304 && cached) return { items: cached.items, fromCache: true, stale: '' }
  if (!res.ok) {
    const err = new HttpError(res.status, url)
    if (cached) return { items: cached.items, fromCache: true, stale: err.message }
    throw err
  }
  let items: CachedListing[]
  try {
    items = parseListings(await res.json())
  } catch (err) {
    if (opts.signal?.aborted) throw new CancelledError()
    if (cached) return { items: cached.items, fromCache: true, stale: "The SimplifyJobs list couldn't be read." }
    throw err instanceof Error ? err : new Error(String(err))
  }
  writeCache(cacheFile, { etag: res.headers.get('etag') ?? '', fetchedAt: new Date().toISOString(), items })
  return { items, fromCache: false, stale: '' }
}

/** True when the entry's terms (e.g. "Summer 2027") fit the wanted term. Entries without terms pass. */
export function termsMatch(terms: string[], wanted: string): boolean {
  const w = wanted.trim().toLowerCase()
  if (!w || !terms.length) return true
  const years = w.match(/20\d\d/g) ?? []
  const seasons = ['spring', 'summer', 'fall', 'winter'].filter((s) => w.includes(s) || (s === 'fall' && w.includes('autumn')))
  return terms.some((t) => {
    const tl = t.toLowerCase()
    const yOk = !years.length || !/20\d\d/.test(tl) || years.some((y) => tl.includes(y))
    const sOk = !seasons.length || !/(spring|summer|fall|winter)/.test(tl) || seasons.some((s) => tl.includes(s))
    return yOk && sOk
  })
}

/** Turns cached entries into postings. Board kind comes from the link when it points at a known board. */
export function listingsToPostings(items: CachedListing[], wantedTerm: string, kind: 'internship' | 'newgrad' = 'internship'): JobPosting[] {
  const out: JobPosting[] = []
  for (const l of items) {
    if (!termsMatch(l.terms, wantedTerm)) continue
    const ref = parsePostingUrl(l.url)
    out.push({
      board: ref?.board ?? 'greenhouse',
      id: l.id,
      company: l.company,
      title: l.title,
      location: l.locations.join('; '),
      url: l.url,
      postedAt: l.postedAt,
      compensation: '',
      // The list has no descriptions; the category and terms are what it says about the role.
      description: '',
      department: [l.category, ...l.terms, kind === 'newgrad' ? 'New grad' : 'Internship'].filter(Boolean).join(', '),
      deadline: '',
    })
  }
  return out
}

/** Whether the link points at a board the app can read for a description. */
export const knownBoardLink = (url: string) => !!parsePostingUrl(url)?.slug
