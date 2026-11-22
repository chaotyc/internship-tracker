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
