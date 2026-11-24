/** Ranking candidates against each application track, by AI when connected and by keywords otherwise. */
import type { ApplicationTrack, Profile, SearchPreferences } from '@shared/profile'
import type { AiService } from '../ai/service'
import type { JobPosting } from './boards'
import { keywordScore, type Scored } from './filter'
import { profileForAi } from './fromLink'
import { CancelledError } from './http'
import { requirementsExcerpt } from './requirements'

export interface TrackScored extends Scored {
  trackId?: string
}

export interface Dismissal {
  title: string
  company: string
}

/** Profile preferences with one track's target roles and keywords in place of the profile's own. */
export function prefsForTrack(prefs: SearchPreferences, t: Pick<ApplicationTrack, 'targetRoles' | 'keywords'>): SearchPreferences {
  return {
    ...prefs,
    targetRoles: t.targetRoles.length ? t.targetRoles : prefs.targetRoles,
    keywords: t.keywords.length ? t.keywords : prefs.keywords,
  }
}

/** Preferences covering every track, for the filter step: a posting passes if it fits any track. */
export function prefsForAllTracks(prefs: SearchPreferences, tracks: Pick<ApplicationTrack, 'targetRoles' | 'keywords'>[]): SearchPreferences {
  const uniq = (xs: string[]) => [...new Map(xs.filter((x) => x.trim()).map((x) => [x.trim().toLowerCase(), x.trim()])).values()]
  return {
    ...prefs,
    targetRoles: uniq([...prefs.targetRoles, ...tracks.flatMap((t) => t.targetRoles)]),
    keywords: uniq([...prefs.keywords, ...tracks.flatMap((t) => t.keywords)]),
  }
}

/** Keyword score against each track; keeps the best one. Ties go to the earlier track. */
export function bestTrackByKeywords(p: JobPosting, prefs: SearchPreferences, tracks: ApplicationTrack[], now?: number, boilerplate?: Set<string>): TrackScored {
  if (!tracks.length) return keywordScore(p, prefs, now, boilerplate)
  let best: TrackScored | null = null
  for (const t of tracks) {
    const s = keywordScore(p, prefsForTrack(prefs, t), now, boilerplate)
    if (!best || s.score > best.score) best = { ...s, trackId: t.id }
  }
  return best!
}

const RANK_SYSTEM = `You rank job postings (internships, new grad or full-time roles, whichever the applicant is looking for) for one applicant who applies on one or more tracks (each a kind of role with its own resume and keywords). For each posting, pick the track it fits best and score 0-100 for how well the applicant, as that track presents them, fits the posting's requirements, term, location and pay. Give one plain sentence saying why (name concrete overlaps or the main gap). Be calibrated: 85+ only for close matches. The applicant recently dismissed some postings; treat those as examples of what they don't want and score similar postings lower. Add "eligible": false only when the posting clearly can't take this applicant: it is limited to a degree level they don't have and aren't working toward (for example PhD students only, for an undergraduate), or it requires years of full-time experience they can't have. Then the reason must say what rules them out. Reply with JSON: {"ranked":[{"i":<index>,"track":"<track id>","score":<0-100>,"reason":"<one sentence>","eligible":<true|false>}]} covering every index.`

/** The ranking prompt: applicant, tracks with resume excerpts, recent dismissals and each posting's requirements. */
export function rankPrompt(candidates: Scored[], profile: Profile, tracks: ApplicationTrack[], dismissed: Dismissal[]): string {
  const general = profileForAi({ ...profile, resume: null })
  const budget = Math.max(1200, Math.floor(7000 / Math.max(1, tracks.length)))
  const trackText = tracks
    .map((t) => {
      const resume = (t.resume ?? profile.resume)?.text?.trim() ?? ''
      return [
        `Track "${t.id}" — ${t.name}`,
        t.description?.trim() && `About: ${t.description.trim()}`,
        t.targetRoles.length && `Target roles: ${t.targetRoles.join('; ')}`,
        t.keywords.length && `Keywords: ${t.keywords.join(', ')}`,
        resume && `Resume excerpt:\n${resume.slice(0, budget)}`,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
  const negatives = dismissed.slice(0, 20).map((d) => `- ${d.title} at ${d.company}`)
  const postings = candidates.map((c, i) => {
    const p = c.posting
    const req = requirementsExcerpt(p.description, 1500)
    return `[${i}] ${p.company} — ${p.title} — ${p.location || 'location not listed'}${p.compensation ? ` — ${p.compensation}` : ''}${p.postedAt ? ` — posted ${p.postedAt}` : ''}\n${req ? `Requirements: ${req}` : '(no description available)'}`
  })
  return [
    `Applicant:\n${general || '(no profile details set up)'}`,
    `Tracks:\n${trackText}`,
    negatives.length && `Recently dismissed (not interested):\n${negatives.join('\n')}`,
    `Postings:\n${postings.join('\n\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export interface AiRanking {
  /** Scored by the AI, best first. */
  ranked: TrackScored[]
  /** Postings the AI said the applicant can't apply to; `reason` is the AI's, or '' when it gave none. */
  ineligible: TrackScored[]
  /** Candidates the AI's reply left out (a cut-off reply, say), with their keyword scores. */
  unranked: TrackScored[]
}

/** A list index from the AI: a whole number, or a string of digits. Anything else (null, "", "first") is not one. */
function indexOf(v: unknown): number {
  if (typeof v === 'number') return v
  return typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN
}

/** Asks the AI to score the candidates per track in one call. Candidates its reply leaves out come back in `unranked`. */
export async function rankWithAi(
  candidates: Scored[],
  profile: Profile,
  ai: AiService,
  signal: AbortSignal,
  tracks: ApplicationTrack[] = [],
  dismissed: Dismissal[] = [],
): Promise<AiRanking | { error: string }> {
  const ids = new Set(tracks.map((t) => t.id))
  const content = rankPrompt(candidates, profile, tracks, dismissed)
  try {
    const out = await ai.json<{ ranked?: { i?: unknown; track?: unknown; score?: unknown; reason?: unknown; eligible?: unknown }[] }>(
      { system: RANK_SYSTEM, messages: [{ role: 'user', content }], json: true },
      { signal },
    )
    const ranked: TrackScored[] = []
    const ineligible: TrackScored[] = []
    const seen = new Set<number>()
    for (const r of Array.isArray(out?.ranked) ? out.ranked : []) {
      if (!r || typeof r !== 'object') continue
      const i = indexOf(r.i)
      if (!Number.isInteger(i) || i < 0 || i >= candidates.length || seen.has(i)) continue
      seen.add(i)
      const c = candidates[i]! as TrackScored
      const n = typeof r.score === 'number' || typeof r.score === 'string' ? Number(r.score) : NaN
      const score = Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : c.score)))
      const said = typeof r.reason === 'string' && r.reason.trim() ? r.reason.replace(/\s+/g, ' ').trim().slice(0, 280) : ''
      const track = typeof r.track === 'string' && ids.has(r.track) ? r.track : c.trackId
      const item: TrackScored = { posting: c.posting, score, reason: said || c.reason, ...(track ? { trackId: track } : {}) }
      if (r.eligible === false || r.eligible === 'false') ineligible.push({ ...item, reason: said })
      else ranked.push(item)
    }
    if (!ranked.length && !ineligible.length) return { error: 'The AI reply had no rankings.' }
    const unranked = candidates.filter((_, i) => !seen.has(i)) as TrackScored[]
    return { ranked: ranked.sort((a, b) => b.score - a.score), ineligible, unranked }
  } catch (err) {
    if (signal.aborted) throw new CancelledError()
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
