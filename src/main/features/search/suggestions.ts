/** The search feature's own table: suggestions autosearch found, plus ones the user added or dismissed. */
import { randomUUID } from 'node:crypto'
import type { Suggestion } from '@shared/search'
import type { Store } from '../../db/store'
import { normalizeUrl } from '../roles/service'

export const searchMigrations = [
  {
    id: 'search-001',
    sql: `CREATE TABLE search_suggestions (
      id TEXT PRIMARY KEY,
      link_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      score REAL NOT NULL,
      data TEXT NOT NULL,
      found_at TEXT NOT NULL
    );
    CREATE INDEX search_suggestions_status ON search_suggestions (status, score);`,
  },
  {
    // When a suggestion was added or dismissed, so the ranker can learn from recent dismissals.
    id: 'search-002',
    sql: `ALTER TABLE search_suggestions ADD COLUMN status_at TEXT;`,
  },
]

type Row = { id: string; link_key: string; status: string; score: number; data: string; found_at: string; status_at?: string | null }

/** What one source returned in a scan, for merge(). */
export interface MergeSource {
  key: string
  /** True when `links` is the whole current list of that source. */
  complete: boolean
  /** Normalized links (linkKey) the source lists now. */
  links: Set<string>
}

const fromRow = (r: Row): Suggestion => ({
  ...(JSON.parse(r.data) as Omit<Suggestion, 'id' | 'status' | 'score' | 'foundAt'>),
  id: r.id,
  status: r.status as Suggestion['status'],
  score: r.score,
  foundAt: r.found_at,
})

export const linkKey = (link: string) => normalizeUrl(link)

export class SuggestionStore {
  constructor(private readonly store: Store) {}

  list(status: Suggestion['status'] = 'new'): Suggestion[] {
    return this.store
      .all<Row>('SELECT * FROM search_suggestions WHERE status = ? ORDER BY score DESC, found_at DESC', [status])
      .map(fromRow)
  }

  get(id: string): Suggestion | null {
    const r = this.store.get<Row>('SELECT * FROM search_suggestions WHERE id = ?', [id])
    return r ? fromRow(r) : null
  }

  /** Links the user already added or dismissed; autosearch skips these. */
  settledKeys(): Set<string> {
    return new Set(
      this.store.all<{ link_key: string }>("SELECT link_key FROM search_suggestions WHERE status != 'new'").map((r) => r.link_key),
    )
  }

  /** Replaces the open suggestions with a fresh set. Added and dismissed rows stay. */
  replaceNew(items: Omit<Suggestion, 'id' | 'status' | 'foundAt'>[]): Suggestion[] {
    const now = new Date().toISOString()
    const settled = this.settledKeys()
    this.store.tx(() => {
      this.store.run("DELETE FROM search_suggestions WHERE status = 'new'")
      for (const s of items) {
        const key = linkKey(s.link)
        if (settled.has(key)) continue
        const { score, ...data } = s
        this.store.run(
          'INSERT OR IGNORE INTO search_suggestions (id, link_key, status, score, data, found_at) VALUES (?, ?, ?, ?, ?, ?)',
          [randomUUID(), key, 'new', score, JSON.stringify(data), now],
        )
      }
    })
    return this.list()
  }

  /**
   * Adds new suggestions next to the ones already waiting, instead of replacing them. For each source that
   * was read completely, waiting suggestions it no longer lists are dropped (the posting closed). Waiting
   * suggestions from sources that failed or weren't read stay as they are.
   */
  merge(items: Omit<Suggestion, 'id' | 'status' | 'foundAt'>[], read: MergeSource[] = []): Suggestion[] {
    const now = new Date().toISOString()
    const settled = this.settledKeys()
    const complete = new Map(read.filter((r) => r.complete).map((r) => [r.key, r.links]))
    this.store.tx(() => {
      if (complete.size) {
        for (const r of this.store.all<Row>("SELECT * FROM search_suggestions WHERE status = 'new'")) {
          const key = (JSON.parse(r.data) as Pick<Suggestion, 'sourceKey'>).sourceKey
          const links = key ? complete.get(key) : undefined
          if (links && !links.has(r.link_key)) this.store.run('DELETE FROM search_suggestions WHERE id = ?', [r.id])
        }
      }
      for (const s of items) {
        const key = linkKey(s.link)
        if (settled.has(key)) continue
        const { score, ...data } = s
        const existing = this.store.get<{ id: string }>("SELECT id FROM search_suggestions WHERE link_key = ? AND status = 'new'", [key])
        if (existing) this.store.run('UPDATE search_suggestions SET score = ?, data = ? WHERE id = ?', [score, JSON.stringify(data), existing.id])
        else
          this.store.run(
            'INSERT OR IGNORE INTO search_suggestions (id, link_key, status, score, data, found_at) VALUES (?, ?, ?, ?, ?, ?)',
            [randomUUID(), key, 'new', score, JSON.stringify(data), now],
          )
      }
    })
    return this.list()
  }

  /** Links waiting as suggestions; autosearch keeps these as they are rather than ranking them again. */
  pendingKeys(): Set<string> {
    return new Set(this.store.all<{ link_key: string }>("SELECT link_key FROM search_suggestions WHERE status = 'new'").map((r) => r.link_key))
  }

  /** The most recent dismissals, newest first: what the user said no to. */
  recentDismissals(limit = 20): { title: string; company: string }[] {
    return this.store
      .all<Row>("SELECT * FROM search_suggestions WHERE status = 'dismissed' ORDER BY COALESCE(status_at, found_at) DESC LIMIT ?", [limit])
      .map(fromRow)
      .map((s) => ({ title: s.title, company: s.company }))
  }

  setStatus(id: string, status: Suggestion['status']): void {
    this.store.run('UPDATE search_suggestions SET status = ?, status_at = ? WHERE id = ?', [status, new Date().toISOString(), id])
  }
}
