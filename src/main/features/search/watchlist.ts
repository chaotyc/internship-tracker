/** The companies autosearch watches, kept in settings, and turning a careers URL into one. */
import { randomUUID } from 'node:crypto'
import type { BoardKind, WatchCompany } from '@shared/search'
import type { Settings } from '../../settings'
import { findBoardInHtml, parseBoardUrl, siteLabel, titleizeSlug, type BoardRef } from './boards'

export { siteLabel }
import { HttpError, getJson, getText, type RequestOptions } from './http'
import { metaContent, pageTitle } from './html'

const KEY = 'search.watchlist'
const BOARDS: BoardKind[] = ['greenhouse', 'ashby', 'lever']

export function loadWatchlist(settings: Settings): WatchCompany[] {
  const list = settings.get<WatchCompany[]>(KEY, [])
  return Array.isArray(list) ? list.filter(isWatchCompany) : []
}

function isWatchCompany(c: unknown): c is WatchCompany {
  const o = c as WatchCompany
  return !!o && typeof o.name === 'string' && typeof o.slug === 'string' && BOARDS.includes(o.board)
}

/** Cleans, de-duplicates (by board + slug) and stores the list. */
export function saveWatchlist(settings: Settings, list: WatchCompany[]): WatchCompany[] {
  const seen = new Set<string>()
  const out: WatchCompany[] = []
  for (const c of list) {
    if (!isWatchCompany(c)) continue
    const slug = c.slug.trim()
    const key = `${c.board}:${slug.toLowerCase()}`
    if (!slug || seen.has(key)) continue
    seen.add(key)
    out.push({ id: c.id || randomUUID(), name: c.name.trim() || titleizeSlug(slug), board: c.board, slug })
  }
  settings.set(KEY, out)
  return out
}

const cleanName = (t: string) =>
  t
    .replace(/^(?:jobs|careers)\s+(?:at|@)\s+/i, '')
    .replace(/\s*(?:[-|–:]\s*)?(?:jobs|careers|job board|open positions)\s*$/i, '')
    .trim()

/**
 * Checks the board answers and returns its display name, or null when no such board exists.
 * Uses each board's lightest call: Greenhouse's board info, Ashby's public page, Lever's API with limit=1.
 */
export async function verifyBoard(ref: BoardRef, opts: RequestOptions = {}): Promise<string | null> {
  const o = { timeoutMs: 15_000, ...opts }
  try {
    if (ref.board === 'greenhouse') {
      const d = await getJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.slug)}`, o)
      return d.name?.trim() || titleizeSlug(ref.slug)
    }
    if (ref.board === 'ashby') {
      const { text } = await getText(`https://jobs.ashbyhq.com/${encodeURIComponent(ref.slug)}`, o)
      const name = cleanName(metaContent(text, 'og:title') || pageTitle(text))
      return name && name.length <= 60 ? name : titleizeSlug(ref.slug)
    }
    const api = ref.eu ? 'https://api.eu.lever.co' : 'https://api.lever.co'
    await getJson(`${api}/v0/postings/${encodeURIComponent(ref.slug)}?mode=json&limit=1`, o)
    try {
      const { text } = await getText(`https://jobs.${ref.eu ? 'eu.' : ''}lever.co/${encodeURIComponent(ref.slug)}`, o)
      const name = cleanName(metaContent(text, 'og:title') || pageTitle(text))
      if (name && name.length <= 60) return name
    } catch {
      /* the API answered; the name is a nicety */
    }
    return titleizeSlug(ref.slug)
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null
    throw err
  }
}

/**
 * Turns what the user pasted into a watchlist entry: a board URL, a company careers page that embeds
 * a board, or a bare board name ("vectorline"). Returns null when no working board is found.
 */
export async function detectBoard(input: string, opts: RequestOptions = {}): Promise<WatchCompany | null> {
  const raw = input.trim()
  if (!raw) return null
  const candidates: BoardRef[] = []
  const direct = parseBoardUrl(raw)
  if (direct) candidates.push(direct)
  else if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw) && !raw.includes('.')) {
    for (const board of BOARDS) candidates.push({ board, slug: raw.toLowerCase() })
  } else {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    let pageError: unknown = null
    try {
      const found = findBoardInHtml((await getText(url, opts)).text)
      if (found) candidates.push(found)
    } catch (err) {
      pageError = err
    }
    // Many companies use their domain name as the board name: acme.com → acme.
    const label = siteLabel(url)
    if (label) for (const board of BOARDS) if (!candidates.some((c) => c.board === board && c.slug === label)) candidates.push({ board, slug: label })
    if (!candidates.length && pageError) throw pageError
  }
  for (const ref of candidates) {
    const name = await verifyBoard(ref, opts)
    if (name) return { id: randomUUID(), name, board: ref.board, slug: ref.slug }
  }
  return null
}

