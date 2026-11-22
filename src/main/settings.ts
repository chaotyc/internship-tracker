import type { Store } from './db/store'

export const settingsMigration = {
  id: 'core-settings-001',
  sql: 'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
}

/** Non-secret JSON settings, one row per key. */
export class Settings {
  constructor(private readonly store: Store) {}

  get<T>(key: string, fallback: T): T {
    const row = this.store.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
  }

  set<T>(key: string, value: T): void {
    this.store.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)],
    )
  }
}
