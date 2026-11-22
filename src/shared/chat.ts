import type { RoleInput } from './roles'
import type { SearchPreferences, SavedAnswer } from './profile'

/** Changes the assistant proposes. Nothing applies until the user confirms it in the sidebar. */
export type ChatAction =
  | { kind: 'add_role'; role: RoleInput }
  | { kind: 'update_preferences'; preferences: Partial<SearchPreferences> }
  | { kind: 'save_answers'; answers: Omit<SavedAnswer, 'id'>[] }
  | { kind: 'move_role'; roleId: string; stage: string }
  /** `due` is YYYY-MM-DD or ''; `time` is HH:MM (24h) or ''. */
  | { kind: 'set_next_step'; roleId: string; text: string; due: string; time: string }

export type ChatActionState = 'proposed' | 'applied' | 'dismissed'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** The role the user had open when they asked, if any. */
  roleId: string | null
  actions: { action: ChatAction; state: ChatActionState }[]
  /** The user pressed Stop before the reply finished. */
  stopped?: boolean
}

export interface ChatChannels {
  'chat:history': { req: void; res: ChatMessage[] }
  /**
   * Streams the reply through chat:delta, then resolves with the saved message.
   * `retry` re-answers the last stored user message instead of adding a new one.
   */
  'chat:send': { req: { text: string; roleId: string | null; retry?: boolean }; res: ChatMessage }
  'chat:stop': { req: void; res: void }
  'chat:applyAction': { req: { messageId: string; index: number }; res: ChatMessage }
  'chat:dismissAction': { req: { messageId: string; index: number }; res: ChatMessage }
  'chat:clear': { req: void; res: void }
}

export interface ChatEvents {
  /** `text` is the whole reply so far (not just the newest piece). */
  'chat:delta': { messageId: string; text: string }
}

/** A whole proposed-action block: ```action {json} ``` (the JSON is group 1). */
export const ACTION_FENCE = /```[ \t]*actions?\b[ \t]*\r?\n?([\s\S]*?)```/g

/**
 * What to show while a reply is still streaming: finished action blocks are
 * removed and an action block that has started but not closed is cut off.
 */
export function visibleReply(text: string): string {
  let out = text.replace(ACTION_FENCE, '')
  const open = out.search(/```[ \t]*actions?\b/)
  if (open >= 0) out = out.slice(0, open)
  // A lone backtick run at the very end may be the start of an action fence.
  out = out.replace(/`{1,3}[a-z]*$/i, (m) => ('```action'.startsWith(m) ? '' : m))
  return out.replace(/\n{3,}/g, '\n\n').trimEnd()
}

const PREF_LABELS: Record<string, string> = {
  targetRoles: 'Target roles',
  locations: 'Locations',
  remoteOk: 'Open to remote',
  term: 'Term',
  minPay: 'Minimum pay',
  keywords: 'Keywords',
  excludeKeywords: 'Exclude',
  notes: 'Notes',
}

export interface ActionSummary {
  title: string
  rows: { label: string; value: string }[]
}

/** A plain description of what applying an action will change. Used by the sidebar cards. */
export function describeAction(
  action: ChatAction,
  lookup: { roleName?: (id: string) => string | null; stageLabel?: (key: string) => string } = {},
): ActionSummary {
  const stage = (k: string) => lookup.stageLabel?.(k) ?? k.charAt(0).toUpperCase() + k.slice(1)
  switch (action.kind) {
    case 'add_role': {
      const r = action.role
      const rows = [
        { label: 'Role', value: `${r.company} · ${r.title}` },
        { label: 'Stage', value: stage(r.stage ?? 'saved') },
      ]
      if (r.location) rows.push({ label: 'Location', value: r.location })
      if (r.pay) rows.push({ label: 'Pay', value: r.pay })
      if (r.deadline) rows.push({ label: 'Deadline', value: r.deadline })
      if (r.fit) rows.push({ label: 'Fit', value: r.fit })
      if (r.link) rows.push({ label: 'Link', value: r.link })
      return { title: 'Add to your board', rows }
    }
    case 'update_preferences': {
      const rows = Object.entries(action.preferences).map(([k, v]) => ({
        label: PREF_LABELS[k] ?? k,
        value: Array.isArray(v) ? v.join(', ') || '(none)' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? '') || '(blank)',
      }))
      return { title: 'Update what you’re looking for', rows }
    }
    case 'save_answers': {
      const n = action.answers.length
      return {
        title: `Save ${n} answer${n === 1 ? '' : 's'} to your profile`,
        rows: action.answers.map((a) => ({ label: a.question, value: a.answer })),
      }
    }
    case 'move_role': {
      const name = lookup.roleName?.(action.roleId) ?? 'A role on your board'
      return { title: `Move to ${stage(action.stage)}`, rows: [{ label: 'Role', value: name }] }
    }
    case 'set_next_step': {
      const name = lookup.roleName?.(action.roleId) ?? 'A role on your board'
      const rows = [
        { label: 'Role', value: name },
        { label: 'Next step', value: action.text },
      ]
      if (action.due) rows.push({ label: 'Due', value: action.time ? `${action.due} ${action.time}` : action.due })
      return { title: 'Set the next step', rows }
    }
  }
}
