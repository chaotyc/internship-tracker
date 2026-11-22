import type { Role, RoleInput } from './roles'

/** A role filled in from a posting, plus which fields came from the posting itself. */
export interface RoleDraft {
  role: RoleInput
  /** Field names that were filled, so the form can highlight them. */
  filled: string[]
  /** Set when only part of the posting could be read. */
  warning: string
}

export type BoardKind = 'greenhouse' | 'ashby' | 'lever' | 'workday'

/** A company whose public job board autosearch scans. */
export interface WatchCompany {
  id: string
  name: string
  board: BoardKind
  /**
   * Board token, e.g. "togetherai" in job-boards.greenhouse.io/togetherai.
   * Workday: "{tenant}.wd{N}/{site}", e.g. "nvidia.wd5/NVIDIAExternalCareerSite".
   */
  slug: string
}

/** Where autosearch found a role: a watched job board, a watched Workday site, or the SimplifyJobs community list. */
export type SuggestionSource = 'boards' | 'workday' | 'simplify'

export const SOURCE_LABELS: Record<SuggestionSource, string> = {
  boards: 'Job boards',
  workday: 'Workday',
  simplify: 'SimplifyJobs list',
}

/** The community internship list autosearch can use as a local index of links. */
export const SIMPLIFY_REPO = 'https://github.com/SimplifyJobs/Summer2027-Internships'
export const SIMPLIFY_NOTE =
  'Uses the SimplifyJobs community list on GitHub only as a local index of links. The list has no license, so the app keeps its copy on this computer and never shares it. Suggestions from it say “via SimplifyJobs list”.'


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
  source?: SuggestionSource
  /** Which watched board or list found it ("greenhouse:acme", "simplify"); merges replace per source. */
  sourceKey?: string
  /** The application track this role fits best; becomes the role's trackId when added. */
  trackId?: string
  trackName?: string
}

export interface SearchOptions {
  /** Which places autosearch reads. Job boards = watched Greenhouse, Ashby and Lever boards. */
  sources: Record<SuggestionSource, boolean>
  /** Scan once a day while the app is open (and on launch when the last scan is over a day old). */
  scheduled: boolean
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = { sources: { boards: true, workday: true, simplify: false }, scheduled: false }

/** The last time one watched board (or the SimplifyJobs list) was read. */
export interface BoardStatus {
  /** ISO time of the last successful read, or null. */
  lastOk: string | null
  /** The last failure's message, cleared by the next success. */
  error: string
  errorAt: string | null
}

export interface SearchStatus {
  options: SearchOptions
  lastScan: { at: string; ok: boolean; summary: string; scheduled: boolean } | null
  /** Keyed like Suggestion.sourceKey: "<board>:<slug>" (slug lowercased), or "simplify". */
  boards: Record<string, BoardStatus>
  running: boolean
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

export const BOARD_LABELS: Record<BoardKind, string> = { greenhouse: 'Greenhouse', ashby: 'Ashby', lever: 'Lever', workday: 'Workday' }

/** Status key for a watched board; matches Suggestion.sourceKey. */
export const boardKey = (c: Pick<WatchCompany, 'board' | 'slug'>) => `${c.board}:${c.slug.toLowerCase()}`

export type SuggestedGroup = 'AI labs and platforms' | 'AI chips' | 'Semiconductors and hardware' | 'Photonics and quantum'

/**
 * Well-known companies offered as one-click additions in Settings > Job boards.
 * Board tokens checked live against each board's public API (Nov 2026). Workday sites were checked with an
 * "intern" search on their job-search endpoint; AMD (iCIMS) and Coherent (Oracle) don't use Workday.
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
  { name: 'NVIDIA', board: 'workday', slug: 'nvidia.wd5/NVIDIAExternalCareerSite', group: 'Semiconductors and hardware' },
  { name: 'Intel', board: 'workday', slug: 'intel.wd1/External', group: 'Semiconductors and hardware' },
  { name: 'Marvell', board: 'workday', slug: 'marvell.wd1/MarvellCareers', group: 'Semiconductors and hardware' },
  { name: 'Broadcom', board: 'workday', slug: 'broadcom.wd1/External_Career', group: 'Semiconductors and hardware' },
  { name: 'Micron', board: 'workday', slug: 'micron.wd1/External', group: 'Semiconductors and hardware' },
  { name: 'Analog Devices', board: 'workday', slug: 'analogdevices.wd1/External', group: 'Semiconductors and hardware' },
  { name: 'Applied Materials', board: 'workday', slug: 'amat.wd1/External', group: 'Semiconductors and hardware' },
  { name: 'KLA', board: 'workday', slug: 'kla.wd1/Search', group: 'Semiconductors and hardware' },
  { name: 'Cadence', board: 'workday', slug: 'cadence.wd1/External_Careers', group: 'Semiconductors and hardware' },
  { name: 'Lightmatter', board: 'greenhouse', slug: 'lightmatter', group: 'Photonics and quantum' },
  { name: 'Lumentum', board: 'workday', slug: 'lumentum.wd5/LITE', group: 'Photonics and quantum' },
  { name: 'Ciena', board: 'workday', slug: 'ciena.wd5/Careers', group: 'Photonics and quantum' },
  { name: 'PsiQuantum', board: 'greenhouse', slug: 'psiquantum', group: 'Photonics and quantum' },
  { name: 'Rigetti Computing', board: 'lever', slug: 'rigetti', group: 'Photonics and quantum' },
]

/** Public careers page for a board entry. */
export function boardUrl(c: Pick<WatchCompany, 'board' | 'slug'>): string {
  if (c.board === 'greenhouse') return `https://job-boards.greenhouse.io/${c.slug}`
  if (c.board === 'ashby') return `https://jobs.ashbyhq.com/${c.slug}`
  if (c.board === 'workday') {
    const [host, site] = c.slug.split('/')
    return `https://${host}.myworkdayjobs.com/${site ?? ''}`
  }
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
  /** Source toggles, the scheduled scan and each board's last check. */
  'search:status': { req: void; res: SearchStatus }
  'search:setOptions': { req: Partial<SearchOptions>; res: SearchStatus }
}

export interface SearchEvents {
  'search:progress': AutosearchProgress
  /** Sent after every scan (manual or scheduled) and when options change. */
  'search:statusChanged': SearchStatus
}
