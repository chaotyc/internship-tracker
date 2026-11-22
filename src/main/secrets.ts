import { safeStorage } from 'electron'
import type { Store } from './db/store'

export const secretsMigration = {
  id: 'core-secrets-001',
  sql: 'CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value BLOB NOT NULL, updated_at TEXT NOT NULL)',
}

/**
 * Values encrypted with the OS keychain (safeStorage) before they touch disk.
 * Used for API keys and the profile.
 *
 * Electron's keychain calls are async, but callers read secrets synchronously, so
 * `load()` decrypts everything once at startup into memory. `set()` updates memory
 * at once and writes the encrypted value in the background, in order; `flush()`
 * waits for those writes (call it before quitting or exporting).
 */
export class Secrets {
  private readonly cache = new Map<string, string>()
  private ok = false
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly store: Store) {}

  async load(): Promise<void> {
    this.ok = await safeStorage.isAsyncEncryptionAvailable()
    if (!this.ok) return
    const rows = this.store.all<{ key: string; value: Uint8Array }>('SELECT key, value FROM secrets')
    for (const row of rows) {
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(row.value))
        this.cache.set(row.key, result)
        if (shouldReEncrypt) this.queue(row.key, result)
      } catch (e) {
        // A value from another machine or a reset keychain can't be read; leave it for the user to re-enter.
        console.warn(`[secrets] could not decrypt ${row.key}:`, e)
      }
    }
  }

  get available(): boolean {
    return this.ok
  }

  set(key: string, value: string): void {
    if (!this.ok) throw new Error('This computer has no keychain available, so secrets cannot be stored safely.')
    this.cache.set(key, value)
    this.queue(key, value)
  }

  get(key: string): string | null {
    return this.cache.get(key) ?? null
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  delete(key: string): void {
    this.cache.delete(key)
    this.writes = this.writes.then(() => this.store.run('DELETE FROM secrets WHERE key = ?', [key]))
  }

  /** Forgets every secret, in memory and on disk. */
  clear(): void {
    this.cache.clear()
    this.writes = this.writes.then(() => this.store.run('DELETE FROM secrets'))
  }

  /** Resolves once every pending encrypted write has reached the store. */
  flush(): Promise<void> {
    return this.writes
  }

  private queue(key: string, value: string): void {
    this.writes = this.writes
      .then(async () => {
        // Skip if the value changed or was deleted while this write waited its turn.
        if (this.cache.get(key) !== value) return
        const blob = await safeStorage.encryptStringAsync(value)
        if (this.cache.get(key) !== value) return
        this.store.run(
          'INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
          [key, new Uint8Array(blob), new Date().toISOString()],
        )
      })
      .catch((e) => console.error(`[secrets] could not save ${key}:`, e))
  }
}
