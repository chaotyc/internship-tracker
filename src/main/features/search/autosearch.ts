/**
 * Autosearch: read the enabled sources (watched job boards, watched Workday sites, the SimplifyJobs list),
 * keep internships that fit, and rank the new ones against each application track.
 */
import { DEFAULT_TRACK_ID, effectiveDegreeLevel, roleTypesOf, type ApplicationTrack, type Profile } from '@shared/profile'
import { DEFAULT_SEARCH_OPTIONS, SKIP_REASONS, boardKey, type AutosearchProgress, type ScanReport, type SkipReason, type SkippedPosting, type Suggestion, type SuggestionSource, type WatchCompany } from '@shared/search'
import type { AiService } from '../ai/service'
import { fetchBoard, fetchPosting, parsePostingUrl, type JobPosting } from './boards'
import { boilerplateKeywords, excludedBy, filterPostings, locationFit, matchesRoleType, rankByKeywords, skipReason, termFits, wantedKeywords, type Skipped } from './filter'
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
  /** Reads a SimplifyJobs list (cached, ETag-checked): internships, or new grad roles. Required when the simplify source is on. */
  loadSimplify?: (signal: AbortSignal, kind: 'internship' | 'newgrad') => Promise<{ items: CachedListing[]; stale: string }>
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
  /** What was left out and why, for "View skipped". */
  report: ScanReport
}

/** At most this many skipped postings are kept per reason; the counts stay exact. */
export const REPORT_CAP = 150
/** When the AI rules out every candidate and there are at least this many, its eligibility calls are ignored. */
export const DISTRUST_ALL_INELIGIBLE = 3

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

  const types = roleTypesOf(prefs.roleTypes)
  const degree = effectiveDegreeLevel(profile)

  // Workday has no "everything" call: search for the role types and target roles, and only read details
  // for list entries whose type, term and place already fit.
  const typeQueries = [types.includes('internship') && 'intern', types.includes('newgrad') && 'new grad'].filter((q): q is string => !!q)
  // Full-time roles have no word of their own to search for; without target roles, the keywords stand in.
  const roleQueries = prefs.targetRoles.length || typeQueries.length ? prefs.targetRoles : prefs.keywords
  const workdayQueries = [...typeQueries, ...roleQueries].slice(0, 5)
  const workdayKeep = (p: JobPosting) =>
    matchesRoleType(p, types) && termFits(p, prefs.term) && locationFit(p.location, prefs) !== 'no' && !excludedBy(p, prefs.excludeKeywords)

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
    // The community lists cover internships and new grad roles; there's no list of other full-time roles.
    const kinds = (['internship', 'newgrad'] as const).filter((k) => types.includes(k))
    for (const kind of kinds) {
      const name = kind === 'internship' ? 'the SimplifyJobs list' : 'the SimplifyJobs new grad list'
      units.push({
        key: kind === 'internship' ? SIMPLIFY_SOURCE_KEY : `${SIMPLIFY_SOURCE_KEY}-newgrad`,
        name,
        source: 'simplify',
        read: async (s) => {
          const { items, stale } = await load(s, kind)
          return { postings: listingsToPostings(items, prefs.term, kind), complete: !stale, links: items.map((i) => i.url), stale }
        },
      })
    }
  }
  if (!units.length) {
    if (!watchlist.length) throw new Error('Add companies in Settings → Job boards, then run Find roles.')
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
      failed.push({ company: u.name.startsWith('the SimplifyJobs') ? u.name.slice(4) : u.name, detail })
      reads.push({ key: u.key, name: u.name, source: u.source, ok: false, error: detail, complete: false, links: new Set() })
      return [] as JobPosting[]
    } finally {
      done++
      if (!signal.aborted) progress({ phase: 'fetching', message: `Read ${u.name}`, done, total: units.length })
    }
  })
  check()
  if (failed.length === units.length) throw new Error(`Couldn't read any job boards. ${failed[0]?.detail ?? ''}`.trim())

  // The same posting can come from a board and a SimplifyJobs list; keep one, preferring the copy with a description.
  const all = dedupePostings(lists.flat())
  progress({ phase: 'filtering', message: `Filtering ${plural(all.length, 'posting')}…`, done: 0, total: all.length })
  const { kept, skipped, counts } = filterPostings(all, prefs, degree)
  const seen = new Set<string>()
  let alreadySeen = 0
  const fresh = kept.filter((p) => {
    const k = linkKey(p.url)
    if (seen.has(k)) return false
    seen.add(k)
    if (deps.settled.has(k) || deps.pending?.has(k) || deps.onBoard(p.url)) {
      alreadySeen++
      return false
    }
    return true
  })
  progress({ phase: 'filtering', message: `${plural(fresh.length, 'new role')} match your preferences`, done: all.length, total: all.length })

  const boilerplate = boilerplateKeywords(all, prefs)
  let candidates: TrackScored[] = rankByKeywords(fresh, prefs, { limit: RANK_LIMIT, boilerplate })
  const shortlisted = new Set(candidates.map((c) => c.posting))
  const late: Skipped[] = fresh.filter((p) => !shortlisted.has(p)).map((p) => ({ posting: p, reason: 'shortlist', detail: `Fit your preferences, but ${RANK_LIMIT} others ranked higher` }))
  candidates = await enrich(candidates, deps, tags)
  check()
  // Postings that had no description (SimplifyJobs) get the description rules once they've been read.
  const kws = wantedKeywords(prefs)
  candidates = candidates.filter((c) => {
    const r = c.posting.description ? skipReason(c.posting, prefs, degree, kws) : null
    if (r) late.push({ posting: c.posting, ...r })
    return !r
  })
  // Best track per posting by keywords: the fallback ranking, and the AI's default when it names no track.
  candidates = candidates.map((c) => bestTrackByKeywords(c.posting, profile.preferences, tracks, undefined, boilerplate.get(c.posting.company)))
  candidates.sort((a, b) => b.score - a.score || b.posting.postedAt.localeCompare(a.posting.postedAt))

  let ranked = candidates
  let rankedBy: 'ai' | 'keywords' = 'keywords'
  /** Postings the AI left unscored; they keep their keyword score and say so. */
  const byKeywords = new Set<JobPosting>()
  let note = ''
  // Nothing new passed the filter: no AI call.
  if (candidates.length) {
    progress({ phase: 'ranking', message: `Ranking ${plural(candidates.length, 'role')} against your profile…`, done: 0, total: candidates.length })
    const res = await rankWithAi(candidates, profile, deps.ai, signal, tracks, deps.dismissed ?? [])
    check()
    if ('ranked' in res) {
      rankedBy = 'ai'
      let { ranked: scored, ineligible } = res
      // Ruling out every one of several roles is more likely a misread profile than the truth: keep them, with the AI's reasons.
      if (!scored.length && ineligible.length >= DISTRUST_ALL_INELIGIBLE) {
        const keywordReason = new Map(candidates.map((c) => [c.posting, c.reason]))
        scored = ineligible.map((x) => ({ ...x, reason: x.reason || keywordReason.get(x.posting) || '' }))
        ineligible = []
        note += ` The AI said you can't apply to any of these ${scored.length} roles, which is likely a mistake, so they're listed anyway; check each one's requirements.`
      }
      for (const x of ineligible) late.push({ posting: x.posting, reason: 'eligibility', detail: x.reason ? `The AI ruled it out: ${x.reason}` : 'The AI ruled it out without saying why.' })
      for (const x of res.unranked) byKeywords.add(x.posting)
      if (res.unranked.length) note += ` The AI skipped ${plural(res.unranked.length, 'role')}; ${res.unranked.length === 1 ? 'it is' : 'they are'} ranked by keyword match.`
      ranked = [...scored, ...res.unranked].sort((a, b) => b.score - a.score || b.posting.postedAt.localeCompare(a.posting.postedAt))
    } else {
      note = /no ai connection/i.test(res.error)
        ? ' Ranked by keyword match; connect an AI provider in Settings for smarter ranking.'
        : ` Ranked by keyword match because the AI step failed: ${res.error}`
    }
  }
  const { total: _total, ...base } = counts
  const report = buildReport(all.length, ranked.length, alreadySeen, base, skipped, late)

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
      rankedBy: byKeywords.has(r.posting) ? 'keywords' : rankedBy,
      ...(tag ? { source: tag.source, sourceKey: tag.sourceKey } : {}),
      ...(track ? { trackId: track.id, ...(named && track.id !== DEFAULT_TRACK_ID ? { trackName: track.name } : {}) } : {}),
    }
  })
  const boardsRead = reads.filter((r) => r.source !== 'simplify' && r.ok).length
  const listsRead = reads.filter((r) => r.source === 'simplify' && r.links.size).length
  const where =
    [boardsRead && plural(boardsRead, 'company', 'companies'), listsRead && (listsRead > 1 ? 'the SimplifyJobs lists' : 'the SimplifyJobs list')].filter(Boolean).join(' and ') ||
    'your sources'
  const summary =
    `${suggestions.length ? `Found ${plural(suggestions.length, 'role')}` : 'No new matching roles'} across ${where}.` +
    skippedSummary(report) +
    note +
    (failed.length ? ` Couldn't read ${failed.map((f) => f.company).join(', ')}.` : '')
  return { suggestions, rankedBy, failed, reads, aiCalled: candidates.length > 0, summary, report }
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

/** A key that is the same for every link to one posting (job-boards. vs boards.greenhouse.io, tracking params). */
function postingKey(url: string): string {
  const ref = parsePostingUrl(url)
  if (!ref) return linkKey(url)
  // Greenhouse, Ashby and Lever ids are unique across the board host; Workday paths only within a site.
  return ref.board === 'workday' ? `workday:${(ref.slug ?? '').toLowerCase()}:${ref.id.toLowerCase()}` : `${ref.board}:${ref.id.toLowerCase()}`
}

/** One posting per link, in first-seen order; a copy with a description replaces one without. */
export function dedupePostings(postings: JobPosting[]): JobPosting[] {
  const by = new Map<string, JobPosting>()
  for (const p of postings) {
    const k = postingKey(p.url)
    const cur = by.get(k)
    if (!cur || (!cur.description.trim() && p.description.trim())) by.set(k, p)
  }
  return [...by.values()]
}

/** Clips long text kept in the saved report ("12 locations…" lists, long quotes). */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** The counts and a capped list of skipped postings. `late` were skipped after the first filter pass. */
function buildReport(total: number, matched: number, alreadySeen: number, base: Omit<ScanReport['counts'], 'shortlist'>, early: Skipped[], late: Skipped[]): ScanReport {
  const counts: Record<SkipReason, number> = { ...base, shortlist: 0 }
  for (const s of late) counts[s.reason]++
  const per = new Map<SkipReason, number>()
  const links = new Set<string>()
  const skipped: SkippedPosting[] = []
  for (const s of [...late, ...early]) {
    const n = per.get(s.reason) ?? 0
    const key = linkKey(s.posting.url)
    if (n >= REPORT_CAP || links.has(key)) continue
    links.add(key)
    per.set(s.reason, n + 1)
    skipped.push({
      company: clip(s.posting.company, 80),
      title: clip(s.posting.title, 160),
      location: clip(s.posting.location, 120),
      link: s.posting.url,
      reason: s.reason,
      detail: clip(s.detail, 300),
    })
  }
  return { at: new Date().toISOString(), total, matched, alreadySeen, counts, skipped }
}

/** " Checked 312 postings; skipped 3 you may not qualify for, 52 in other places, 180 other role types." Only the reasons that skipped something. */
function skippedSummary(r: ScanReport): string {
  const parts = SKIP_REASONS.filter((x) => r.counts[x.key]).map((x) => `${r.counts[x.key]} ${x.summary}`)
  return r.total ? ` Checked ${plural(r.total, 'posting')}${parts.length ? `; skipped ${parts.join(', ')}` : ''}.` : ''
}
