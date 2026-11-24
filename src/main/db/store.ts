import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'

export type Params = SqlValue[] | Record<string, SqlValue>

export interface Migration {
  /** Unique across the app, prefixed with the feature name: "roles-001". */
  id: string
  sql: string
}

/**
 * A small SQLite store on top of sql.js (WebAssembly, so no native rebuilds).
 * The whole database lives in memory and is written to disk atomically after
 * each change, debounced. Fine for one person's application data.
 */
export class Store {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly db: Database,
    private readonly file: string | null,
  ) {
    this.db.run('PRAGMA foreign_keys = ON')
    // Deleted rows (a removed chat, an erased profile) are overwritten, not left in free pages.
    this.db.run('PRAGMA secure_delete = ON')
  }

  all<T = Record<string, unknown>>(sql: string, params: Params = []): T[] {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }

  get<T = Record<string, unknown>>(sql: string, params: Params = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  run(sql: string, params: Params = []): void {
    this.db.run(sql, params)
    this.schedulePersist()
  }

  /** Runs fn inside a transaction; rolls back if it throws. */
  tx<T>(fn: () => T): T {
    this.db.run('BEGIN')
    try {
      const out = fn()
      this.db.run('COMMIT')
      this.schedulePersist()
      return out
    } catch (e) {
      this.db.run('ROLLBACK')
      throw e
    }
  }

  migrate(migrations: Migration[]): void {
    this.db.run('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    const done = new Set(this.all<{ id: string }>('SELECT id FROM _migrations').map((r) => r.id))
    for (const m of migrations) {
      if (done.has(m.id)) continue
      this.tx(() => {
        this.db.exec(m.sql)
        this.db.run('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)', [m.id, new Date().toISOString()])
      })
    }
  }

  /**
   * Writes now. Call on quit. The file is replaced atomically (write a temp file,
   * fsync it, rename over), so a crash or power cut leaves the old or the new copy,
   * never a half-written one.
   */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = this.file + '.tmp'
    const data = this.db.export()
    const fd = openSync(tmp, 'w', 0o600)
    try {
      let off = 0
      while (off < data.byteLength) off += writeSync(fd, data, off, data.byteLength - off)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, this.file)
  }

  /**
   * Drops every row from every table except migrations, then compacts the file so
   * the deleted rows can't be recovered from free pages, and writes it now.
   */
  wipe(): void {
    const tables = this.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations'",
    )
    this.tx(() => {
      for (const t of tables) this.db.run(`DELETE FROM "${t.name.replace(/"/g, '""')}"`)
    })
    this.db.run('VACUUM')
    this.flush()
  }

  private schedulePersist(): void {
    if (!this.file) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      try {
        this.flush()
      } catch (err) {
        // A full disk or a locked file: keep the data in memory and try again shortly.
        console.error('[store] save failed, retrying:', err)
        if (!this.timer) this.timer = setTimeout(() => this.schedulePersist(), 5000)
      }
    }, 250)
  }
}

function wasmDir(): string {
  return dirname(require.resolve('sql.js/dist/sql-wasm.wasm'))
}

/** Opens (or creates) the database file. Pass null for an in-memory store (tests). */
export async function openStore(file: string | null): Promise<Store> {
  const SQL = await initSqlJs({ locateFile: (f: string) => join(wasmDir(), f) })
  const data = file && existsSync(file) ? readFileSync(file) : undefined
  return new Store(new SQL.Database(data), file)
}
