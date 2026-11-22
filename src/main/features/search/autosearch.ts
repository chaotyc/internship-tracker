/**
 * Autosearch: read the enabled sources (watched job boards, watched Workday sites, the SimplifyJobs list),
 * keep internships that fit, and rank the new ones against each application track.
 */
import { DEFAULT_TRACK_ID, type ApplicationTrack, type Profile } from '@shared/profile'
import { DEFAULT_SEARCH_OPTIONS, boardKey, type AutosearchProgress, type Suggestion, type SuggestionSource, type WatchCompany } from '@shared/search'
import type { AiService } from '../ai/service'
import { fetchBoard, fetchPosting, parsePostingUrl, type JobPosting } from './boards'
import { boilerplateKeywords, excludedBy, filterPostings, isInternshipLike, matchesLocation, matchesTerm, rankByKeywords } from './filter'
import { CancelledError, mapLimit } from './http'
import { bestTrackByKeywords, prefsForAllTracks, rankWithAi, type Dismissal, type TrackScored } from './rank'
import { SIMPLIFY_SOURCE_KEY, knownBoardLink, listingsToPostings, type CachedListing } from './simplify'
import { linkKey } from './suggestions'

export { rankWithAi }

export const RANK_LIMIT = 40
/** SimplifyJobs entries have no description; this many of the best are read from their board before ranking. */
export const ENRICH_LIMIT = 15

export interface AutosearchDeps {
  watchlist: WatchCompany[]
  profile: Profile
  /** From ctx.services.profile.tracks(); always at least one. Defaults to none (profile only). */
  tracks?: ApplicationTrack[]
  /** The last ~20 dismissed suggestions, sent to the AI as negative examples. */
  dismissed?: Dismissal[]
  sources?: Record<SuggestionSource, boolean>
  ai: AiService
  /** True when the link is already on the board. */
  onBoard: (link: string) => boolean
  /** Normalized links the user already added or dismissed. */
  settled: Set<string>
  /** Normalized links already waiting as suggestions; they are kept as they are, not ranked again. */
  pending?: Set<string>
  progress: (p: AutosearchProgress) => void
  signal: AbortSignal
  fetchBoard?: typeof fetchBoard
  fetchPosting?: typeof fetchPosting
  /** Reads the SimplifyJobs list (cached, ETag-checked). Required when the simplify source is on. */
  loadSimplify?: (signal: AbortSignal) => Promise<{ items: CachedListing[]; stale: string }>
}

export type NewSuggestion = Omit<Suggestion, 'id' | 'status' | 'foundAt'>

/** What one source returned, for the per-board status and the per-source merge. */
export interface SourceRead {
  key: string
  name: string
  source: SuggestionSource
  ok: boolean
  error: string
  /** True when `links` is the source's whole current list, so suggestions missing from it can go. */
  complete: boolean
  links: Set<string>
}

export interface AutosearchOutcome {
  suggestions: NewSuggestion[]
  rankedBy: 'ai' | 'keywords'
  failed: { company: string; detail: string }[]
  reads: SourceRead[]
  /** False when nothing new passed the filter, so no AI call was made. */
  aiCalled: boolean
  summary: string
}

const plural = (n: number, w: string, many = w + 's') => `${n} ${n === 1 ? w : many}`

interface Unit {
  key: string
  name: string
  source: SuggestionSource
  read: (signal: AbortSignal) => Promise<{ postings: JobPosting[]; complete: boolean; links?: string[]; stale?: string }>
}

interface Tagged {
  source: SuggestionSource
  sourceKey: string
}

export async function runAutosearch(deps: AutosearchDeps): Promise<AutosearchOutcome> {
  const { watchlist, profile, signal, progress } = deps
  const sources = deps.sources ?? DEFAULT_SEARCH_OPTIONS.sources
  const tracks = deps.tracks ?? []
  const read = deps.fetchBoard ?? fetchBoard
  const check = () => {
    if (signal.aborted) throw new CancelledError()
  }
  const prefs = prefsForAllTracks(profile.preferences, tracks)

  // Workday has no "everything" call: search for "intern" and the target roles, and only read details
  // for list entries whose title, term and place already fit.
  const workdayQueries = ['intern', ...prefs.targetRoles].slice(0, 4)
  const workdayKeep = (p: JobPosting) =>
    isInternshipLike(p) && matchesTerm(p.title, prefs.term) && matchesLocation(p.location, prefs) && !excludedBy(p, prefs.excludeKeywords)

  const units: Unit[] = []
  for (const c of watchlist) {
    const source: SuggestionSource = c.board === 'workday' ? 'workday' : 'boards'
    if (!sources[source]) continue
    units.push({
      key: boardKey(c),
      name: c.name,
      source,
      read: async (s) => ({
        postings: await read({ board: c.board, slug: c.slug }, c.name, {
          signal: s,
          ...(c.board === 'workday' ? { workday: { queries: workdayQueries, keep: workdayKeep, maxDetails: 25 } } : {}),
        }),
        // A Workday search shows part of the site, so a missing posting doesn't mean it closed.
        complete: c.board !== 'workday',
      }),
    })
  }
  if (sources.simplify && deps.loadSimplify) {
    const load = deps.loadSimplify
    units.push({
      key: SIMPLIFY_SOURCE_KEY,
      name: 'the SimplifyJobs list',
      source: 'simplify',
      read: async (s) => {
        const { items, stale } = await load(s)
        return { postings: listingsToPostings(items, prefs.term), complete: !stale, links: items.map((i) => i.url), stale }
      },
    })
  }
  if (!units.length) {
    if (!watchlist.length) throw new Error('Add companies in Settings → Job boards, then run autosearch.')
    throw new Error('Every source is turned off. Turn one on in Settings → Job boards.')
  }

  let done = 0
  const failed: AutosearchOutcome['failed'] = []
  const reads: SourceRead[] = []
  const tags = new Map<JobPosting, Tagged>()
  const what = units.every((u) => u.source !== 'simplify') ? 'job board' : 'source'
  progress({ phase: 'fetching', message: `Reading ${plural(units.length, what)}…`, done: 0, total: units.length })
  const lists = await mapLimit(units, 4, async (u) => {
    check()
    try {
      const r = await u.read(signal)
      for (const p of r.postings) tags.set(p, { source: u.source, sourceKey: u.key })
      const links = new Set((r.links ?? r.postings.map((p) => p.url)).map(linkKey))
      reads.push({ key: u.key, name: u.name, source: u.source, ok: !r.stale, error: r.stale ?? '', complete: r.complete, links })
      return r.postings
    } catch (err) {
      if (signal.aborted) throw new CancelledError()
      const detail = err instanceof Error ? err.message : String(err)
      failed.push({ company: u.name === 'the SimplifyJobs list' ? 'SimplifyJobs list' : u.name, detail })
      reads.push({ key: u.key, name: u.name, source: u.source, ok: false, error: detail, complete: false, links: new Set() })
      return [] as JobPosting[]
    } finally {
      done++
      if (!signal.aborted) progress({ phase: 'fetching', message: `Read ${u.name}`, done, total: units.length })
    }
  })
  check()
  if (failed.length === units.length) throw new Error(`Couldn't read any job boards. ${failed[0]?.detail ?? ''}`.trim())

  const all = lists.flat()
  progress({ phase: 'filtering', message: `Filtering ${plural(all.length, 'posting')}…`, done: 0, total: all.length })
  const { kept } = filterPostings(all, prefs)
  const seen = new Set<string>()
  const fresh = kept.filter((p) => {
    const k = linkKey(p.url)
    if (seen.has(k) || deps.settled.has(k) || deps.pending?.has(k) || deps.onBoard(p.url)) return false
    seen.add(k)
    return true
  })
  progress({ phase: 'filtering', message: `${plural(fresh.length, 'new internship')} match your preferences`, done: all.length, total: all.length })

  const boilerplate = boilerplateKeywords(all, prefs)
  let candidates: TrackScored[] = rankByKeywords(fresh, prefs, { limit: RANK_LIMIT, boilerplate })
  candidates = await enrich(candidates, deps, tags)
  check()
  // Best track per posting by keywords: the fallback ranking, and the AI's default when it names no track.
  candidates = candidates.map((c) => bestTrackByKeywords(c.posting, profile.preferences, tracks, undefined, boilerplate.get(c.posting.company)))
  candidates.sort((a, b) => b.score - a.score || b.posting.postedAt.localeCompare(a.posting.postedAt))

  let ranked = candidates
  let rankedBy: 'ai' | 'keywords' = 'keywords'
  let note = ''
  // Nothing new passed the filter: no AI call.
  if (candidates.length) {
    progress({ phase: 'ranking', message: `Ranking ${plural(candidates.length, 'role')} against your profile…`, done: 0, total: candidates.length })
    const res = await rankWithAi(candidates, profile, deps.ai, signal, tracks, deps.dismissed ?? [])
    check()
    if ('ranked' in res) {
      ranked = res.ranked
      rankedBy = 'ai'
    } else {
      note = /no ai connection/i.test(res.error)
        ? ' Ranked by keyword match; connect an AI provider in Settings for smarter ranking.'
        : ` Ranked by keyword match because the AI step failed: ${res.error}`
    }
  }

  const named = profile.tracks.length > 0
  const suggestions: NewSuggestion[] = ranked.map((r) => {
    const tag = tags.get(r.posting)
    const track = r.trackId ? tracks.find((t) => t.id === r.trackId) : undefined
    const board = tag?.source === 'simplify' ? parsePostingUrl(r.posting.url)?.board : r.posting.board
    return {
      company: r.posting.company,
      title: r.posting.title,
      link: r.posting.url,
      location: r.posting.location,
      postedAt: r.posting.postedAt,
      score: r.score,
      reason: r.reason,
      pay: r.posting.compensation,
      ...(board ? { board } : {}),
      rankedBy,
      ...(tag ? { source: tag.source, sourceKey: tag.sourceKey } : {}),
      ...(track ? { trackId: track.id, ...(named && track.id !== DEFAULT_TRACK_ID ? { trackName: track.name } : {}) } : {}),
    }
  })
  const boardsRead = reads.filter((r) => r.source !== 'simplify' && r.ok).length
  const listRead = reads.some((r) => r.source === 'simplify' && r.links.size)
  const where = [boardsRead && plural(boardsRead, 'company', 'companies'), listRead && 'the SimplifyJobs list'].filter(Boolean).join(' and ') || 'your sources'
  const summary =
    `${suggestions.length ? `Found ${plural(suggestions.length, 'role')}` : 'No new matching roles'} across ${where}.` +
    note +
    (failed.length ? ` Couldn't read ${failed.map((f) => f.company).join(', ')}.` : '')
  return { suggestions, rankedBy, failed, reads, aiCalled: candidates.length > 0, summary }
}

/**
 * SimplifyJobs entries carry no description. For the best few whose link is on a board the app reads,
 * fetch the posting (two at a time) so ranking sees its requirements; drop ones the board says closed.
 */
async function enrich(candidates: TrackScored[], deps: AutosearchDeps, tags: Map<JobPosting, Tagged>): Promise<TrackScored[]> {
  const get = deps.fetchPosting ?? fetchPosting
  const targets = candidates
    .filter((c) => tags.get(c.posting)?.source === 'simplify' && !c.posting.description && knownBoardLink(c.posting.url))
    .slice(0, ENRICH_LIMIT)
  if (!targets.length) return candidates
  const closed = new Set<JobPosting>()
  await mapLimit(targets, 2, async (c) => {
    if (deps.signal.aborted) return
    const ref = parsePostingUrl(c.posting.url)
    if (!ref) return
    try {
      const full = await get(ref, { signal: deps.signal, timeoutMs: 20_000 })
      if (!full) closed.add(c.posting)
      else {
        c.posting.description = full.description
        if (!c.posting.compensation) c.posting.compensation = full.compensation
        if (!c.posting.location) c.posting.location = full.location
      }
    } catch {
      /* keep the list entry as it is */
    }
  })
  return candidates.filter((c) => !closed.has(c.posting))
}
