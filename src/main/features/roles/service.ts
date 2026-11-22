import { randomUUID } from 'node:crypto'
import { STAGE_KEYS, type Role, type RoleInput, type RolePatch, type StageKey } from '@shared/roles'
import type { Store } from '../../db/store'
import { emit } from '../../ipc'
import { orderAt } from '@shared/order'

export const rolesMigrations = [
  {
    id: 'roles-001',
    sql: `CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      stage TEXT NOT NULL,
      sort_order REAL NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX roles_stage ON roles (stage, sort_order);`,
  },
]

type Row = { id: string; stage: string; sort_order: number; data: string; created_at: string; updated_at: string }

const BLANK: Omit<Role, 'id' | 'company' | 'title' | 'createdAt' | 'updatedAt' | 'order'> = {
  stage: 'saved',
  link: '',
  location: '',
  pay: '',
  deadline: '',
  fit: '',
  priority: '',
  why: '',
  watch: '',
  notes: '',
  postingStatus: '',
  appliedOn: '',
  source: 'manual',
  liveness: { status: 'unknown', checkedAt: null, detail: '' },
}

const today = () => new Date().toISOString().slice(0, 10)
const countsAsApplied = (s: StageKey) => s === 'applied' || s === 'interviewing' || s === 'offer' || s === 'rejected'

function fromRow(r: Row): Role {
  const data = JSON.parse(r.data) as Partial<Role>
  return {
    ...BLANK,
    company: '',
    title: '',
    ...data,
    id: r.id,
    stage: (STAGE_KEYS as string[]).includes(r.stage) ? (r.stage as StageKey) : 'saved',
    order: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** The single place roles are read and written. Other features call this, never the table. */
export class RolesService {
  constructor(
    private readonly store: Store,
    private readonly notify: (ids: string[]) => void = (ids) => emit('roles:changed', { ids }),
  ) {}

  list(): Role[] {
    return this.store.all<Row>('SELECT * FROM roles ORDER BY stage, sort_order').map(fromRow)
  }

  get(id: string): Role | null {
    const r = this.store.get<Row>('SELECT * FROM roles WHERE id = ?', [id])
    return r ? fromRow(r) : null
  }

  findByLink(link: string): Role | null {
    if (!link) return null
    return this.list().find((r) => r.link && normalizeUrl(r.link) === normalizeUrl(link)) ?? null
  }

  create(input: RoleInput): Role {
    const company = input.company.trim()
    const title = input.title.trim()
    if (!company || !title) throw new Error('A role needs a company and a title.')
    const stage = input.stage && STAGE_KEYS.includes(input.stage) ? input.stage : 'saved'
    const now = new Date().toISOString()
    const role: Role = {
      ...BLANK,
      ...input,
      company,
      title,
      stage,
      id: randomUUID(),
      appliedOn: input.appliedOn || (countsAsApplied(stage) ? today() : ''),
      order: orderAt(this.orders(stage), 0),
      createdAt: now,
      updatedAt: now,
    }
    this.write(role, true)
    this.notify([role.id])
    return role
  }

  createMany(inputs: RoleInput[]): { added: number; skipped: number } {
    const existing = new Set(this.list().map((r) => key(r.company, r.title)))
    let added = 0
    let skipped = 0
    const ids: string[] = []
    this.store.tx(() => {
      for (const input of inputs) {
        const k = key(input.company, input.title)
        if (existing.has(k)) {
          skipped++
          continue
        }
        existing.add(k)
        const stage = input.stage ?? 'saved'
        const now = new Date().toISOString()
        const orders = this.orders(stage)
        const role: Role = {
          ...BLANK,
          ...input,
          stage,
          id: randomUUID(),
          appliedOn: input.appliedOn || '',
          order: (orders[orders.length - 1] ?? 0) + 1024,
          createdAt: now,
          updatedAt: now,
        }
        this.write(role, true)
        ids.push(role.id)
        added++
      }
    })
    if (ids.length) this.notify(ids)
    return { added, skipped }
  }

  update(id: string, patch: RolePatch): Role {
    const cur = this.get(id)
    if (!cur) throw new Error('That role no longer exists.')
    const next: Role = { ...cur, ...patch, id, createdAt: cur.createdAt, updatedAt: new Date().toISOString() }
    if (patch.stage && patch.stage !== cur.stage) {
      if (patch.order == null) next.order = orderAt(this.orders(patch.stage), Number.MAX_SAFE_INTEGER)
      if (countsAsApplied(patch.stage) && !next.appliedOn) next.appliedOn = today()
    }
    this.write(next, false)
    this.notify([id])
    return next
  }

  move(id: string, stage: StageKey, index: number): Role {
    const cur = this.get(id)
    if (!cur) throw new Error('That role no longer exists.')
    const others = this.orders(stage, id)
    const patch: RolePatch = { stage, order: orderAt(others, index) }
    if (countsAsApplied(stage) && !cur.appliedOn) patch.appliedOn = today()
    return this.update(id, patch)
  }

  delete(id: string): void {
    this.store.run('DELETE FROM roles WHERE id = ?', [id])
    this.notify([id])
  }

  private orders(stage: StageKey, exclude?: string): number[] {
    return this.store
      .all<{ sort_order: number }>('SELECT sort_order FROM roles WHERE stage = ? AND id != ? ORDER BY sort_order', [
        stage,
        exclude ?? '',
      ])
      .map((r) => r.sort_order)
  }

  private write(role: Role, insert: boolean): void {
    const { id, stage, order, createdAt, updatedAt, ...data } = role
    if (insert) {
      this.store.run('INSERT INTO roles (id, stage, sort_order, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
        id,
        stage,
        order,
        JSON.stringify(data),
        createdAt,
        updatedAt,
      ])
    } else {
      this.store.run('UPDATE roles SET stage = ?, sort_order = ?, data = ?, updated_at = ? WHERE id = ?', [
        stage,
        order,
        JSON.stringify(data),
        updatedAt,
        id,
      ])
    }
  }
}

const key = (company: string, title: string) => `${company.trim().toLowerCase()}|${title.trim().toLowerCase()}`

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u.trim())
    url.hash = ''
    for (const p of [...url.searchParams.keys()]) if (/^(utm_|gh_src|source|ref)/i.test(p)) url.searchParams.delete(p)
    return (url.origin + url.pathname).replace(/\/+$/, '').toLowerCase() + (url.search || '')
  } catch {
    return u.trim().toLowerCase()
  }
}
