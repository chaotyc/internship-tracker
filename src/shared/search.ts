import type { Role, RoleInput } from './roles'

/** A role filled in from a posting, plus which fields came from the posting itself. */
export interface RoleDraft {
  role: RoleInput
  /** Field names that were filled, so the form can highlight them. */
  filled: string[]
  /** Set when only part of the posting could be read. */
  warning: string
}

export type BoardKind = 'greenhouse' | 'ashby' | 'lever'

/** A company whose public job board autosearch scans. */
export interface WatchCompany {
  id: string
  name: string
  board: BoardKind
  /** Board token, e.g. "togetherai" in job-boards.greenhouse.io/togetherai */
  slug: string
}

export interface Suggestion {
  id: string
  company: string
  title: string
  link: string
  location: string
  postedAt: string
  /** 0-100 match against the profile and preferences. */
  score: number
  reason: string
  status: 'new' | 'added' | 'dismissed'
  foundAt: string
  /** Pay as the posting prints it, or ''. */
  pay?: string
  board?: BoardKind
  /** How the score was made: by the connected AI, or by keyword match when no AI is connected. */
  rankedBy?: 'ai' | 'keywords'
}

export interface AutosearchProgress {
  phase: 'fetching' | 'filtering' | 'ranking' | 'done' | 'error'
  message: string
  done: number
  total: number
}

export interface RefreshResult {
  checked: number
  closed: Pick<Role, 'id' | 'company' | 'title'>[]
  expiring: Pick<Role, 'id' | 'company' | 'title' | 'deadline'>[]
  failed: { id: string; company: string; detail: string }[]
}

export const BOARD_LABELS: Record<BoardKind, string> = { greenhouse: 'Greenhouse', ashby: 'Ashby', lever: 'Lever' }

export type SuggestedGroup = 'AI labs and platforms' | 'AI chips' | 'Photonics and quantum'

/**
 * Well-known companies offered as one-click additions in Settings > Job boards.
 * Board tokens checked live against each board's public API (Nov 2026).
 */
export const SUGGESTED_COMPANIES: (Omit<WatchCompany, 'id'> & { group: SuggestedGroup })[] = [
  { name: 'Anthropic', board: 'greenhouse', slug: 'anthropic', group: 'AI labs and platforms' },
  { name: 'OpenAI', board: 'ashby', slug: 'openai', group: 'AI labs and platforms' },
  { name: 'xAI', board: 'greenhouse', slug: 'xai', group: 'AI labs and platforms' },
  { name: 'Cohere', board: 'ashby', slug: 'cohere', group: 'AI labs and platforms' },
  { name: 'Together AI', board: 'greenhouse', slug: 'togetherai', group: 'AI labs and platforms' },
  { name: 'Perplexity', board: 'ashby', slug: 'perplexity', group: 'AI labs and platforms' },
  { name: 'Databricks', board: 'greenhouse', slug: 'databricks', group: 'AI labs and platforms' },
  { name: 'Scale AI', board: 'greenhouse', slug: 'scaleai', group: 'AI labs and platforms' },
  { name: 'Figure', board: 'greenhouse', slug: 'figureai', group: 'AI labs and platforms' },
  { name: 'Baseten', board: 'ashby', slug: 'baseten', group: 'AI labs and platforms' },
  { name: 'Etched', board: 'ashby', slug: 'etched', group: 'AI chips' },
  { name: 'Cerebras', board: 'ashby', slug: 'cerebras', group: 'AI chips' },
  { name: 'MatX', board: 'ashby', slug: 'matx', group: 'AI chips' },
  { name: 'Tenstorrent', board: 'greenhouse', slug: 'tenstorrent', group: 'AI chips' },
  { name: 'SambaNova', board: 'greenhouse', slug: 'sambanovasystems', group: 'AI chips' },
  { name: 'd-Matrix', board: 'ashby', slug: 'd-matrix', group: 'AI chips' },
  { name: 'Graphcore', board: 'greenhouse', slug: 'graphcore', group: 'AI chips' },
  { name: 'Lightmatter', board: 'greenhouse', slug: 'lightmatter', group: 'Photonics and quantum' },
  { name: 'PsiQuantum', board: 'greenhouse', slug: 'psiquantum', group: 'Photonics and quantum' },
  { name: 'Rigetti Computing', board: 'lever', slug: 'rigetti', group: 'Photonics and quantum' },
]

/** Public careers page for a board entry. */
export function boardUrl(c: Pick<WatchCompany, 'board' | 'slug'>): string {
  if (c.board === 'greenhouse') return `https://job-boards.greenhouse.io/${c.slug}`
  if (c.board === 'ashby') return `https://jobs.ashbyhq.com/${c.slug}`
  return `https://jobs.lever.co/${c.slug}`
}

export interface SearchChannels {
  'search:watchlist': { req: void; res: WatchCompany[] }
  'search:saveWatchlist': { req: WatchCompany[]; res: WatchCompany[] }
  /** Turns a careers URL into a watchlist entry, e.g. https://jobs.ashbyhq.com/etched */
  'search:detectBoard': { req: { url: string }; res: WatchCompany | null }
  'search:run': { req: void; res: Suggestion[] }
  'search:cancel': { req: void; res: void }
  'search:suggestions': { req: void; res: Suggestion[] }
  'search:addSuggestion': { req: { id: string }; res: Role }
  'search:dismissSuggestion': { req: { id: string }; res: void }
  /** Reads a posting (board API or page text) and returns the fields for a new role. Does not save it. */
  'search:fromLink': { req: { url: string }; res: RoleDraft }
  /** Checks every Saved role with a link; marks closed and expiring postings. */
  'search:refresh': { req: void; res: RefreshResult }
}

export interface SearchEvents {
  'search:progress': AutosearchProgress
}
