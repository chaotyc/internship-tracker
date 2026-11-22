import type { Profile } from '@shared/profile'
import type { Store } from '../../db/store'

/** Names that look like credentials. Matched against settings keys, object keys and column names. */
const SECRETISH = /(api[-_]?key|access[-_]?key|private[-_]?key|^key$|token|secret|password|passphrase|credential|cookie|session[-_]?id)/i

/** Tables never exported generically: internal, encrypted, or exported in a typed form below. */
const SKIP_TABLES = new Set(['_migrations', 'secrets', 'settings', 'roles'])

/** Recursively drops credential-looking keys and binary blobs. */
export function scrub(value: unknown): unknown {
  if (value instanceof Uint8Array) return undefined
  if (Array.isArray(value)) return value.map(scrub).filter((v) => v !== undefined)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (SECRETISH.test(k)) continue
      const s = scrub(v)
      if (s !== undefined) out[k] = s
    }
    return out
  }
  return value
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return v
  try {
    return JSON.parse(t)
  } catch {
    return v
  }
}

export interface ExportDeps {
  store: Store
  profile: { get(): Profile }
  roles?: { list(): unknown[] }
}

/**
 * Everything the user owns, as one JSON document: roles, the decrypted profile,
 * settings without API keys, and any other feature tables (chats, suggestions,
 * watchlists...) read generically so this keeps working as features are added.
 */
export function buildExport({ store, profile, roles }: ExportDeps): Record<string, unknown> {
  const tables = store
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((t) => t.name)

  const settings: Record<string, unknown> = {}
  if (tables.includes('settings')) {
    for (const row of store.all<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key')) {
      // The profile is exported in full below; a plain copy here would only duplicate it.
      if (row.key === 'profile' || SECRETISH.test(row.key)) continue
      const v = scrub(parseMaybeJson(row.value))
      if (v !== undefined) settings[row.key] = v
    }
  }

  const other: Record<string, unknown[]> = {}
  for (const name of tables) {
    if (SKIP_TABLES.has(name) || SECRETISH.test(name)) continue
    const rows = store.all(`SELECT * FROM "${name.replace(/"/g, '""')}"`)
    other[name] = rows.map((r) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) out[k] = parseMaybeJson(v)
      return scrub(out)
    })
  }

  let roleRows: unknown[] = []
  if (roles) roleRows = roles.list()
  else if (tables.includes('roles')) roleRows = store.all('SELECT * FROM roles')

  return {
    app: 'Internship Tracker',
    format: 1,
    exportedAt: new Date().toISOString(),
    note: 'API keys and other secrets are never included in exports.',
    roles: roleRows,
    profile: profile.get(),
    settings,
    tables: other,
  }
}
