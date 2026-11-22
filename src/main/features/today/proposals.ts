import { randomUUID } from 'node:crypto'
import type { Role, RolePatch, StageKey } from '@shared/roles'
import { localIso, type EmailProposal, type IngestResult, type ProposalStatus } from '@shared/today'
import type { Migration, Store } from '../../db/store'
import type { AiService } from '../ai/service'
import { buildProposalRequest, parseAiProposal } from './ai'
import { formatFrom, parseEmail, type ParsedEmail } from './email'
import { matchEmail } from './match'
import { ruleProposal, type ProposalDraft } from './rules'

export const todayMigrations: Migration[] = [
  {
    id: 'today-001',
    sql: `CREATE TABLE today_proposals (
      id TEXT PRIMARY KEY,
      message_key TEXT NOT NULL UNIQUE,
      role_id TEXT NOT NULL,
      status TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX today_proposals_status ON today_proposals (status, created_at);`,
  },
]

type Row = { id: string; message_key: string; role_id: string; status: string; data: string; created_at: string }

function fromRow(r: Row): EmailProposal {
  const data = JSON.parse(r.data) as Omit<EmailProposal, 'id' | 'roleId' | 'status' | 'createdAt'>
  return { ...data, id: r.id, roleId: r.role_id, status: r.status as ProposalStatus, createdAt: r.created_at }
}

/** Pending, applied and dismissed proposals. Stores sender, subject and date, never the body. */
export class ProposalStore {
  constructor(private readonly store: Store) {}

  pending(): EmailProposal[] {
    return this.store.all<Row>("SELECT * FROM today_proposals WHERE status = 'pending' ORDER BY created_at DESC").map(fromRow)
  }

  get(id: string): EmailProposal | null {
    const r = this.store.get<Row>('SELECT * FROM today_proposals WHERE id = ?', [id])
    return r ? fromRow(r) : null
  }

  byKey(key: string): EmailProposal | null {
    const r = this.store.get<Row>('SELECT * FROM today_proposals WHERE message_key = ?', [key])
    return r ? fromRow(r) : null
  }

  add(key: string, p: Omit<EmailProposal, 'id' | 'status' | 'createdAt'>): EmailProposal {
    const { roleId, ...data } = p
    const id = randomUUID()
    const now = new Date().toISOString()
    this.store.run('INSERT INTO today_proposals (id, message_key, role_id, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      id,
      key,
      roleId,
      'pending',
      JSON.stringify(data),
      now,
      now,
    ])
    return this.get(id)!
  }

  setStatus(id: string, status: ProposalStatus): EmailProposal {
    this.store.run('UPDATE today_proposals SET status = ?, updated_at = ? WHERE id = ?', [status, new Date().toISOString(), id])
    const p = this.get(id)
    if (!p) throw new Error('That proposal no longer exists.')
    return p
  }

  /** Proposals for a role that was deleted can't be applied; drop them from the list. */
  prune(roleIds: Set<string>): void {
    for (const p of this.pending()) if (!roleIds.has(p.roleId)) this.setStatus(p.id, 'dismissed')
  }
}

export interface HookDeps {
  proposals: ProposalStore
  roles: {
    list(): Role[]
    get(id: string): Role | null
    update(id: string, patch: RolePatch): Role
    move(id: string, stage: StageKey, index: number): Role
  }
  ai: Pick<AiService, 'json' | 'status'>
  changed: () => void
  today?: () => string
}

const NO_AI = 'No AI connection, so this was worked out from simple keyword rules. Check the details.'

/** Works out a proposal for an email already matched to a role: AI if connected, else rules. */
export async function draftProposal(
  email: ParsedEmail,
  role: Role,
  deps: Pick<HookDeps, 'ai'>,
  today = localIso(),
): Promise<{ draft: ProposalDraft | null; via: 'ai' | 'rules'; note: string }> {
  let note = NO_AI
  let hasAi = false
  try {
    hasAi = (await deps.ai.status()).some((s) => s.available)
  } catch {
    hasAi = false
  }
  if (hasAi) {
    try {
      const raw = await deps.ai.json<unknown>(buildProposalRequest(email, role, today))
      return { draft: parseAiProposal(raw, role), via: 'ai', note: '' }
    } catch (err) {
      note = `The AI couldn't read this one (${err instanceof Error ? err.message : String(err)}), so it was worked out from simple keyword rules.`
    }
  }
  return { draft: ruleProposal(email, role, today), via: 'rules', note }
}

/**
 * Turns an email into a pending proposal. Nothing on the board changes here; an
 * email that matches no role stops before the AI.
 */
export async function ingestEmail(
  email: ParsedEmail,
  deps: HookDeps,
  opts: { origin: 'paste' | 'inbox'; roleId?: string },
): Promise<IngestResult> {
  const existing = deps.proposals.byKey(email.key)
  if (existing) {
    if (opts.origin === 'paste' && existing.status === 'dismissed') {
      const back = deps.proposals.setStatus(existing.id, 'pending')
      deps.changed()
      return { kind: 'duplicate', proposal: back }
    }
    return { kind: 'duplicate', proposal: existing }
  }
  const roles = deps.roles.list()
  const role = opts.roleId ? (deps.roles.get(opts.roleId) ?? null) : (matchEmail(email, roles, { lenient: opts.origin === 'paste' })?.role ?? null)
  if (!role) return { kind: 'unmatched', from: formatFrom(email.from), subject: email.subject }

  const { draft, via, note } = await draftProposal(email, role, deps, deps.today?.() ?? localIso())
  if (!draft || (!draft.stage && !draft.nextStep)) {
    return {
      kind: 'nothing',
      roleId: role.id,
      company: role.company,
      summary: draft?.summary || (via === 'rules' ? `Matched ${role.company}, but the simple rules found nothing to change. ${note}` : `Matched ${role.company}; nothing to change.`),
    }
  }
  const proposal = deps.proposals.add(email.key, {
    roleId: role.id,
    company: role.company,
    title: role.title,
    email: { from: formatFrom(email.from), subject: email.subject, date: email.date },
    summary: draft.summary,
    stage: draft.stage,
    nextStep: draft.nextStep,
    via,
    note,
    origin: opts.origin,
  })
  deps.changed()
  return { kind: 'proposal', proposal }
}

export async function ingestRaw(raw: string, deps: HookDeps, roleId?: string): Promise<IngestResult> {
  if (!raw.trim()) throw new Error('Paste an email first.')
  const email = await parseEmail(raw)
  if (!email.text && !email.subject) throw new Error("That doesn't look like an email.")
  return ingestEmail(email, deps, { origin: 'paste', roleId })
}

/** Applies a proposal through the roles service. Parts can be left out. */
export function applyProposal(id: string, deps: HookDeps, parts: { stage?: boolean; nextStep?: boolean } = {}): EmailProposal {
  const p = deps.proposals.get(id)
  if (!p) throw new Error('That proposal no longer exists.')
  if (p.status !== 'pending') throw new Error(p.status === 'applied' ? 'That update was already applied.' : 'That update was dismissed.')
  const role = deps.roles.get(p.roleId)
  if (!role) throw new Error('That role is no longer on your board.')
  if (parts.stage !== false && p.stage && p.stage !== role.stage) deps.roles.move(role.id, p.stage, 0)
  if (parts.nextStep !== false && p.nextStep) deps.roles.update(role.id, { nextStep: { ...p.nextStep, done: false, source: 'email' } })
  const out = deps.proposals.setStatus(id, 'applied')
  deps.changed()
  return out
}

export function dismissProposal(id: string, deps: HookDeps): EmailProposal {
  if (!deps.proposals.get(id)) throw new Error('That proposal no longer exists.')
  const out = deps.proposals.setStatus(id, 'dismissed')
  deps.changed()
  return out
}
