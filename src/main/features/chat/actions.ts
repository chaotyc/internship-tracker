import { randomUUID } from 'node:crypto'
import { ACTION_FENCE, type ChatAction } from '@shared/chat'
import { FITS, STAGES, STAGE_KEYS, type Fit, type RoleInput, type StageKey } from '@shared/roles'
import type { Profile, SavedAnswer, SearchPreferences } from '@shared/profile'
import type { Role, RolePatch } from '@shared/roles'
import { isIsoDate } from '@shared/today'

/** Turns a short id or full id the model wrote back into a real role id, or null. */
export type RoleResolver = (ref: string) => string | null

const MAX_FIELD = 4000
const str = (v: unknown, max = MAX_FIELD): string => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '')

function parseJsonLoose(raw: string): unknown {
  const body = raw.trim()
  if (!body) return undefined
  try {
    return JSON.parse(body)
  } catch {
    // Models sometimes leave trailing commas or // comments; try once more without them.
    try {
      return JSON.parse(body.replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1'))
    } catch {
      return undefined
    }
  }
}

export function toStage(v: unknown): StageKey | null {
  const s = str(v).toLowerCase()
  if (!s) return null
  if ((STAGE_KEYS as string[]).includes(s)) return s as StageKey
  return STAGES.find((st) => st.label.toLowerCase() === s)?.key ?? null
}

function toList(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map((x) => str(x, 200)).filter(Boolean).slice(0, 50)
  if (typeof v === 'string') return v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 50)
  return null
}

function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 'yes') return true
  if (v === 'false' || v === 'no') return false
  return null
}

const ROLE_TEXT_FIELDS = ['location', 'pay', 'priority', 'why', 'watch', 'notes', 'postingStatus'] as const

function toRole(v: unknown): RoleInput | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const company = str(o['company'], 200)
  const title = str(o['title'], 300)
  if (!company || !title) return null
  const role: RoleInput = { company, title, stage: toStage(o['stage']) ?? 'saved', source: 'chat' }
  for (const f of ROLE_TEXT_FIELDS) {
    const val = str(o[f])
    if (val) role[f] = val
  }
  const link = str(o['link'], 2000)
  if (/^https?:\/\/\S+$/i.test(link)) role.link = link
  const deadline = str(o['deadline'], 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) role.deadline = deadline
  const fit = str(o['fit'])
  const match = FITS.find((f) => f.toLowerCase() === fit.toLowerCase())
  if (match) role.fit = match as Fit
  return role
}

function toPreferences(v: unknown): Partial<SearchPreferences> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const out: Partial<SearchPreferences> = {}
  for (const k of ['targetRoles', 'locations', 'keywords', 'excludeKeywords'] as const) {
    if (k in o) {
      const list = toList(o[k])
      if (list) out[k] = list
    }
  }
  for (const k of ['term', 'minPay', 'notes'] as const) {
    if (k in o && (typeof o[k] === 'string' || typeof o[k] === 'number')) out[k] = str(o[k])
  }
  if ('remoteOk' in o) {
    const b = toBool(o['remoteOk'])
    if (b != null) out.remoteOk = b
  }
  return Object.keys(out).length ? out : null
}

function toAnswers(v: unknown): Omit<SavedAnswer, 'id'>[] | null {
  if (!Array.isArray(v)) return null
  const out = v
    .map((a) => (a && typeof a === 'object' ? (a as Record<string, unknown>) : {}))
    .map((a) => ({ question: str(a['question'], 500), answer: str(a['answer']) }))
    .filter((a) => a.question && a.answer)
    .slice(0, 20)
  return out.length ? out : null
}

/** Checks one parsed object against the ChatAction shapes. Returns null for anything unusable. */
export function validateAction(raw: unknown, resolveRole?: RoleResolver): ChatAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const kind = str(o['kind'] ?? o['type'] ?? o['action'])
  switch (kind) {
    case 'add_role': {
      const role = toRole(o['role'] ?? o)
      return role ? { kind, role } : null
    }
    case 'update_preferences': {
      const preferences = toPreferences(o['preferences'] ?? o['changes'])
      return preferences ? { kind, preferences } : null
    }
    case 'save_answers': {
      const answers = toAnswers(o['answers'] ?? (o['question'] ? [o] : undefined))
      return answers ? { kind, answers } : null
    }
    case 'move_role': {
      const ref = str(o['roleId'] ?? o['role_id'] ?? o['id'], 64)
      const stage = toStage(o['stage'])
      if (!ref || !stage) return null
      const roleId = resolveRole ? resolveRole(ref) : ref
      return roleId ? { kind, roleId, stage } : null
    }
    case 'set_next_step': {
      const ref = str(o['roleId'] ?? o['role_id'] ?? o['id'], 64)
      const step = (o['nextStep'] && typeof o['nextStep'] === 'object' ? o['nextStep'] : o) as Record<string, unknown>
      const text = str(step['text'] ?? step['step'], 200).replace(/\s+/g, ' ')
      if (!ref || !text) return null
      const roleId = resolveRole ? resolveRole(ref) : ref
      if (!roleId) return null
      const due = str(step['due'] ?? step['date'], 10)
      const time = str(step['time'], 5)
      const validDue = isIsoDate(due) ? due : ''
      return { kind, roleId, text, due: validDue, time: validDue && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '' }
    }
    default:
      return null
  }
}

/**
 * Splits a finished reply into what the user reads and the actions it proposes.
 * Invalid blocks are dropped silently; the text around them is kept.
 */
export function parseReply(text: string, resolveRole?: RoleResolver): { text: string; actions: ChatAction[] } {
  const actions: ChatAction[] = []
  const seen = new Set<string>()
  const stripped = text.replace(ACTION_FENCE, (_m, body: string) => {
    const parsed = parseJsonLoose(body)
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      const action = validateAction(item, resolveRole)
      if (!action) continue
      const key = JSON.stringify(action)
      if (seen.has(key)) continue
      seen.add(key)
      actions.push(action)
    }
    return ''
  })
  // An unterminated block at the end (the model stopped mid-way) is hidden too.
  const open = stripped.search(/```[ \t]*actions?\b/)
  const visible = open >= 0 ? stripped.slice(0, open) : stripped
  return { text: visible.replace(/\n{3,}/g, '\n\n').trim(), actions: actions.slice(0, 8) }
}

/** Resolves full ids and the 8-character short ids the prompt shows. Ambiguous prefixes resolve to nothing. */
export function roleResolver(roles: Pick<Role, 'id'>[]): RoleResolver {
  return (ref) => {
    const r = ref.trim().toLowerCase()
    if (r.length < 4) return null
    const exact = roles.find((x) => x.id.toLowerCase() === r)
    if (exact) return exact.id
    const hits = roles.filter((x) => x.id.toLowerCase().startsWith(r))
    return hits.length === 1 ? hits[0]!.id : null
  }
}

export interface ApplyDeps {
  roles: {
    list(): Role[]
    get(id: string): Role | null
    create(input: RoleInput): Role
    move(id: string, stage: StageKey, index: number): Role
    update(id: string, patch: RolePatch): Role
  }
  profile: { get(): Profile | Promise<Profile>; save(p: Profile): Profile | Promise<Profile> }
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Makes the change an action describes. Throws a readable message when it can't. */
export async function applyAction(action: ChatAction, deps: ApplyDeps): Promise<void> {
  switch (action.kind) {
    case 'add_role': {
      const dup = deps.roles.list().find((r) => sameText(r.company, action.role.company) && sameText(r.title, action.role.title))
      if (dup) throw new Error(`${dup.company} · ${dup.title} is already on your board.`)
      deps.roles.create({ ...action.role, source: 'chat' })
      return
    }
    case 'move_role': {
      const role = deps.roles.get(action.roleId)
      if (!role) throw new Error('That role is no longer on your board.')
      const stage = toStage(action.stage)
      if (!stage) throw new Error(`“${action.stage}” isn't a stage on the board.`)
      deps.roles.move(role.id, stage, 0)
      return
    }
    case 'set_next_step': {
      const role = deps.roles.get(action.roleId)
      if (!role) throw new Error('That role is no longer on your board.')
      deps.roles.update(role.id, { nextStep: { text: action.text, due: action.due, time: action.due ? action.time : '', done: false, source: 'chat' } })
      return
    }
    case 'update_preferences': {
      const profile = await deps.profile.get()
      await deps.profile.save({ ...profile, preferences: { ...profile.preferences, ...action.preferences } })
      return
    }
    case 'save_answers': {
      const profile = await deps.profile.get()
      const answers = [...profile.answers]
      for (const a of action.answers) {
        const i = answers.findIndex((x) => sameText(x.question, a.question))
        if (i >= 0) answers[i] = { ...answers[i]!, answer: a.answer }
        else answers.push({ id: randomUUID(), question: a.question, answer: a.answer })
      }
      await deps.profile.save({ ...profile, answers })
      return
    }
  }
}
