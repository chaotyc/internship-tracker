/** Autosearch: read the watched boards, keep internships that fit, rank them against the profile. */
import type { Profile } from '@shared/profile'
import type { AutosearchProgress, Suggestion, WatchCompany } from '@shared/search'
import type { AiService } from '../ai/service'
import { fetchBoard, type JobPosting } from './boards'
import { boilerplateKeywords, filterPostings, rankByKeywords, type Scored } from './filter'
import { profileForAi } from './fromLink'
import { CancelledError, mapLimit } from './http'
import { linkKey } from './suggestions'

export const RANK_LIMIT = 40

export interface AutosearchDeps {
  watchlist: WatchCompany[]
  profile: Profile
  ai: AiService
  /** True when the link is already on the board. */
  onBoard: (link: string) => boolean
  /** Normalized links the user already added or dismissed. */
  settled: Set<string>
  progress: (p: AutosearchProgress) => void
  signal: AbortSignal
  fetchBoard?: typeof fetchBoard
}

export type NewSuggestion = Omit<Suggestion, 'id' | 'status' | 'foundAt'>

export interface AutosearchOutcome {
  suggestions: NewSuggestion[]
  rankedBy: 'ai' | 'keywords'
  failed: { company: string; detail: string }[]
  summary: string
}

const plural = (n: number, w: string, many = w + 's') => `${n} ${n === 1 ? w : many}`

const RANK_SYSTEM = `You rank internship postings for one applicant. Score each posting 0-100 for how well it fits the applicant's background, target roles, term, location and pay, and give one plain sentence saying why (name concrete overlaps or the main gap). Be calibrated: 85+ only for close matches. Reply with JSON: {"ranked":[{"i":<index>,"score":<0-100>,"reason":"<one sentence>"}]} covering every index.`

/** Asks the AI to score the candidates. Returns null when the AI isn't available or answers badly. */
export async function rankWithAi(
  candidates: Scored[],
  profile: Profile,
  ai: AiService,
  signal: AbortSignal,
): Promise<{ ranked: Scored[] } | { error: string }> {
  const lines = candidates.map((c, i) => {
    const p = c.posting
    const desc = p.description.replace(/\s+/g, ' ').slice(0, 500)
    return `[${i}] ${p.company} — ${p.title} — ${p.location || 'location not listed'}${p.compensation ? ` — ${p.compensation}` : ''}${p.postedAt ? ` — posted ${p.postedAt}` : ''}\n${desc}`
  })
  const content = `Applicant:\n${profileForAi(profile, 6000) || '(no profile details set up)'}\n\nPostings:\n${lines.join('\n\n')}`
  try {
    const out = await ai.json<{ ranked?: { i?: unknown; score?: unknown; reason?: unknown }[] }>(
      { system: RANK_SYSTEM, messages: [{ role: 'user', content }], json: true },
      { signal },
    )
    const ranked: Scored[] = []
    const seen = new Set<number>()
    for (const r of out?.ranked ?? []) {
      const i = typeof r.i === 'number' ? r.i : Number(r.i)
      if (!Number.isInteger(i) || i < 0 || i >= candidates.length || seen.has(i)) continue
      seen.add(i)
      const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)))
      const reason = typeof r.reason === 'string' && r.reason.trim() ? r.reason.replace(/\s+/g, ' ').trim().slice(0, 280) : candidates[i]!.reason
      ranked.push({ posting: candidates[i]!.posting, score, reason })
    }
    if (!ranked.length) return { error: 'The AI reply had no rankings.' }
    return { ranked: ranked.sort((a, b) => b.score - a.score) }
  } catch (err) {
    if (signal.aborted) throw new CancelledError()
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runAutosearch(deps: AutosearchDeps): Promise<AutosearchOutcome> {
  const { watchlist, profile, signal, progress } = deps
  const read = deps.fetchBoard ?? fetchBoard
  const check = () => {
    if (signal.aborted) throw new CancelledError()
  }
  if (!watchlist.length) throw new Error('Add companies in Settings → Job boards, then run autosearch.')

  let done = 0
  const failed: AutosearchOutcome['failed'] = []
  progress({ phase: 'fetching', message: `Reading ${plural(watchlist.length, 'job board')}…`, done: 0, total: watchlist.length })
  const lists = await mapLimit(watchlist, 4, async (c) => {
    check()
    try {
      return await read({ board: c.board, slug: c.slug }, c.name, { signal })
    } catch (err) {
      if (signal.aborted) throw new CancelledError()
      failed.push({ company: c.name, detail: err instanceof Error ? err.message : String(err) })
      return [] as JobPosting[]
    } finally {
      done++
      if (!signal.aborted) progress({ phase: 'fetching', message: `Read ${c.name}`, done, total: watchlist.length })
    }
  })
  check()
  if (failed.length === watchlist.length) throw new Error(`Couldn't read any job boards. ${failed[0]?.detail ?? ''}`.trim())

  const all = lists.flat()
  progress({ phase: 'filtering', message: `Filtering ${plural(all.length, 'posting')}…`, done: 0, total: all.length })
  const prefs = profile.preferences
  const { kept } = filterPostings(all, prefs)
  const seen = new Set<string>()
  const fresh = kept.filter((p) => {
    const k = linkKey(p.url)
    if (seen.has(k) || deps.settled.has(k) || deps.onBoard(p.url)) return false
    seen.add(k)
    return true
  })
  progress({ phase: 'filtering', message: `${plural(fresh.length, 'new internship')} match your preferences`, done: all.length, total: all.length })

  const candidates = rankByKeywords(fresh, prefs, { limit: RANK_LIMIT, boilerplate: boilerplateKeywords(all, prefs) })
  let ranked = candidates
  let rankedBy: 'ai' | 'keywords' = 'keywords'
  let note = ''
  if (candidates.length) {
    progress({ phase: 'ranking', message: `Ranking ${plural(candidates.length, 'role')} against your profile…`, done: 0, total: candidates.length })
    const res = await rankWithAi(candidates, profile, deps.ai, signal)
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

  const suggestions: NewSuggestion[] = ranked.map((r) => ({
    company: r.posting.company,
    title: r.posting.title,
    link: r.posting.url,
    location: r.posting.location,
    postedAt: r.posting.postedAt,
    score: r.score,
    reason: r.reason,
    pay: r.posting.compensation,
    board: r.posting.board,
    rankedBy,
  }))
  const companiesRead = watchlist.length - failed.length
  const summary =
    `${suggestions.length ? `Found ${plural(suggestions.length, 'role')}` : 'No new matching roles'} across ${plural(companiesRead, 'company', 'companies')}.` +
    note +
    (failed.length ? ` Couldn't read ${failed.map((f) => f.company).join(', ')}.` : '')
  return { suggestions, rankedBy, failed, summary }
}
