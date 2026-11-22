/** Search options (sources, scheduled scan) and what the last scans found, kept in plain settings. */
import { DEFAULT_SEARCH_OPTIONS, type BoardStatus, type SearchOptions, type SearchStatus, type SuggestionSource } from '@shared/search'
import type { Settings } from '../../settings'
import type { SourceRead } from './autosearch'

const OPTIONS = 'search.options'
const BOARDS = 'search.boardStatus'
const LAST_SCAN = 'search.lastScan'

const SOURCES: SuggestionSource[] = ['boards', 'workday', 'simplify']

export function loadOptions(settings: Settings): SearchOptions {
  const raw = settings.get<Partial<SearchOptions>>(OPTIONS, {})
  const sources = { ...DEFAULT_SEARCH_OPTIONS.sources }
  for (const s of SOURCES) if (typeof raw?.sources?.[s] === 'boolean') sources[s] = raw.sources[s]
  return { sources, scheduled: typeof raw?.scheduled === 'boolean' ? raw.scheduled : DEFAULT_SEARCH_OPTIONS.scheduled }
}

export function saveOptions(settings: Settings, patch: Partial<SearchOptions>): SearchOptions {
  const cur = loadOptions(settings)
  const sources = { ...cur.sources }
  for (const s of SOURCES) if (typeof patch.sources?.[s] === 'boolean') sources[s] = patch.sources[s]
  const next: SearchOptions = { sources, scheduled: typeof patch.scheduled === 'boolean' ? patch.scheduled : cur.scheduled }
  settings.set(OPTIONS, next)
  return next
}

export type LastScan = NonNullable<SearchStatus['lastScan']>

export function loadLastScan(settings: Settings): LastScan | null {
  const v = settings.get<LastScan | null>(LAST_SCAN, null)
  return v && typeof v.at === 'string' ? v : null
}

export function saveLastScan(settings: Settings, scan: LastScan): void {
  settings.set(LAST_SCAN, scan)
}

export function loadBoardStatus(settings: Settings): Record<string, BoardStatus> {
  const v = settings.get<Record<string, BoardStatus>>(BOARDS, {})
  return v && typeof v === 'object' ? v : {}
}

/** Records each source's result: a success sets lastOk and clears the error; a failure keeps lastOk. */
export function recordReads(settings: Settings, reads: Pick<SourceRead, 'key' | 'ok' | 'error'>[], now = new Date()): Record<string, BoardStatus> {
  const all = loadBoardStatus(settings)
  const at = now.toISOString()
  for (const r of reads) {
    const prev = all[r.key] ?? { lastOk: null, error: '', errorAt: null }
    all[r.key] = r.ok ? { lastOk: at, error: '', errorAt: null } : { lastOk: prev.lastOk, error: r.error || 'Failed.', errorAt: at }
  }
  settings.set(BOARDS, all)
  return all
}

export function statusOf(settings: Settings, running: boolean): SearchStatus {
  return { options: loadOptions(settings), lastScan: loadLastScan(settings), boards: loadBoardStatus(settings), running }
}
