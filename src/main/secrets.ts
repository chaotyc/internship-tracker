import { safeStorage } from 'electron'
import type { Store } from './db/store'

export const secretsMigration = {
  id: 'core-secrets-001',
  sql: 'CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value BLOB NOT NULL, updated_at TEXT NOT NULL)',
}

/**
 * Values encrypted with the OS keychain (safeStorage) before they touch disk.
 * Used for API keys and the sensitive parts of the profile.
 */
export class Secrets {
  constructor(private readonly store: Store) {}

  get available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  set(key: string, value: string): void {
    if (!this.available) throw new Error('This computer has no keychain available, so secrets cannot be stored safely.')
    const blob = safeStorage.encryptString(value)
    this.store.run(
      'INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      [key, new Uint8Array(blob), new Date().toISOString()],
    )
  }

  get(key: string): string | null {
    const row = this.store.get<{ value: Uint8Array }>('SELECT value FROM secrets WHERE key = ?', [key])
    if (!row || !this.available) return null
    try {
      return safeStorage.decryptString(Buffer.from(row.value))
    } catch {
      return null
    }
  }

  has(key: string): boolean {
    return !!this.store.get('SELECT 1 AS x FROM secrets WHERE key = ?', [key])
  }

  delete(key: string): void {
    this.store.run('DELETE FROM secrets WHERE key = ?', [key])
  }
}
