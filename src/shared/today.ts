import type { NextStep, StageKey } from './roles'

/** One row in the Today view: a dated (or undated) next step, or a posting deadline. */
export interface TodayItem {
  roleId: string
  company: string
  title: string
  stage: StageKey
  kind: 'next-step' | 'deadline'
  text: string
  /** YYYY-MM-DD, or '' for an undated next step (deadlines always have a date). */
  due: string
  /** HH:MM or '' */
  time: string
  /** The role's posting deadline, shown beside a next step due on or before it in the same section (instead of a separate row). */
  deadline?: string
}

export type TodaySectionKey = 'overdue' | 'today' | 'week' | 'later' | 'undated'

export const TODAY_SECTIONS: { key: TodaySectionKey; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'undated', label: 'No date yet' },
]

/* ----------------------------------- dates ----------------------------------- */

const DAY = 86_400_000
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** YYYY-MM-DD in local time (not UTC, so late-evening dates don't jump a day). */
export function localIso(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function isIsoDate(s: string): boolean {
  if (!ISO.test(s)) return false
  const d = new Date(s + 'T12:00:00')
  return !Number.isNaN(d.getTime()) && localIso(d) === s
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return localIso(d)
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function dayDiff(from: string, to: string): number {
  return Math.round((new Date(to + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / DAY)
}

/** The next Monday strictly after `today`, skipping one that is only a day away (that's "tomorrow"). */
export function nextMonday(today: string): string {
  const dow = new Date(today + 'T12:00:00').getDay() // 0 = Sunday
  const ahead = ((8 - dow) % 7) || 7
  return addDays(today, ahead === 1 ? 8 : ahead)
}

/* --------------------------------- grouping --------------------------------- */

/** Deadlines further back than this are stale facts, not things to do. */
export const STALE_DEADLINE_DAYS = 14

export function sectionOf(item: Pick<TodayItem, 'due'>, today: string): TodaySectionKey {
  if (!item.due) return 'undated'
  const d = dayDiff(today, item.due)
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  if (d <= 6) return 'week'
  return 'later'
}

const STAGE_WEIGHT: Record<StageKey, number> = { offer: 0, interviewing: 1, applied: 2, saved: 3, rejected: 4, closed: 5 }

/** Soonest first; on the same day, timed items by time, then untimed; next steps before deadlines. */
export function compareItems(a: TodayItem, b: TodayItem): number {
  if (a.due !== b.due) {
    if (!a.due) return 1
    if (!b.due) return -1
    return a.due < b.due ? -1 : 1
  }
  if (a.time !== b.time) {
    if (!a.time) return 1
    if (!b.time) return -1
    return a.time < b.time ? -1 : 1
  }
  if (a.kind !== b.kind) return a.kind === 'next-step' ? -1 : 1
  if (a.stage !== b.stage) return STAGE_WEIGHT[a.stage] - STAGE_WEIGHT[b.stage]
  return a.company.localeCompare(b.company)
}

export interface TodaySection {
  key: TodaySectionKey
  label: string
  items: TodayItem[]
}

/** Splits items into the Today view's sections, in order, leaving out empty ones. */
export function groupToday(items: TodayItem[], today: string): TodaySection[] {
  const by = new Map<TodaySectionKey, TodayItem[]>(TODAY_SECTIONS.map((s) => [s.key, []]))
  for (const it of items) by.get(sectionOf(it, today))!.push(it)
  return TODAY_SECTIONS.map((s) => ({ ...s, items: by.get(s.key)!.sort(compareItems) })).filter((s) => s.items.length)
}

/** What the Today view lists for a set of roles. Finished roles (rejected, closed) never appear. */
export function todayItems(
  roles: { id: string; company: string; title: string; stage: StageKey; deadline: string; nextStep: NextStep | null }[],
  today: string,
): TodayItem[] {
  const items: TodayItem[] = []
  for (const r of roles) {
    if (r.stage === 'rejected' || r.stage === 'closed') continue
    const base = { roleId: r.id, company: r.company, title: r.title, stage: r.stage }
    const ns = r.nextStep
    const hasStep = !!ns && !ns.done && !!(ns.text.trim() || ns.due)
    const stepDue = hasStep && isIsoDate(ns!.due) ? ns!.due : ''
    const deadline = r.deadline && isIsoDate(r.deadline) && dayDiff(today, r.deadline) >= -STALE_DEADLINE_DAYS ? r.deadline : ''
    // One row per role when its dated step comes first and both land in the same section: the deadline
    // rides along on that row. Otherwise the deadline gets its own row, so per-section counts stay right.
    const fold = !!deadline && !!stepDue && stepDue <= deadline && sectionOf({ due: stepDue }, today) === sectionOf({ due: deadline }, today)
    if (hasStep)
      items.push({
        ...base,
        kind: 'next-step',
        text: ns!.text.trim() || 'Next step',
        due: stepDue,
        time: stepDue ? ns!.time : '',
        ...(fold ? { deadline } : {}),
      })
    if (deadline && !fold)
      items.push({ ...base, kind: 'deadline', text: r.stage === 'saved' ? 'Application due' : 'Deadline', due: deadline, time: '' })
  }
  return items.sort(compareItems)
}

/* ---------------------------------- filter ---------------------------------- */

/** True when every word of the filter appears somewhere in `fields` (case-insensitive), like the board's filter. */
function matchesWords(fields: (string | null | undefined)[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fields.filter(Boolean).join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** Filters Today rows by company, title and step text. */
export function itemMatches(item: Pick<TodayItem, 'company' | 'title' | 'text'>, query: string): boolean {
  return matchesWords([item.company, item.title, item.text], query)
}

/** Filters email proposals by company, title, summary and proposed step text. */
export function proposalMatches(p: Pick<EmailProposal, 'company' | 'title' | 'summary' | 'nextStep'>, query: string): boolean {
  return matchesWords([p.company, p.title, p.summary, p.nextStep?.text], query)
}

/** How many things want a look today: pending proposals plus overdue and due-today rows. */
export function attentionCount(items: Pick<TodayItem, 'due'>[], proposals: number, today: string): number {
  return proposals + items.filter((i) => {
    const s = sectionOf(i, today)
    return s === 'overdue' || s === 'today'
  }).length
}

/* ------------------------------ done and snooze ------------------------------ */

export type SnoozeKey = 'tomorrow' | 'next-week'

export function snoozeDate(when: SnoozeKey, today: string): string {
  return when === 'tomorrow' ? addDays(today, 1) : nextMonday(today)
}

/** The next step after snoozing: new date, same time of day, still open. */
export function snoozeStep(step: NextStep, when: SnoozeKey, today: string): NextStep {
  return { ...step, due: snoozeDate(when, today), done: false }
}

export function completeStep(step: NextStep): NextStep {
  return { ...step, done: true }
}

/* --------------------------------- email hook -------------------------------- */

export type ProposalStatus = 'pending' | 'applied' | 'dismissed'

/** A change an email suggests for one role. Never applied without the user's click. */
export interface EmailProposal {
  id: string
  roleId: string
  /** Snapshot for display, in case the role is renamed or deleted. */
  company: string
  title: string
  status: ProposalStatus
  email: { from: string; subject: string; date: string }
  /** One line: what the email says. */
  summary: string
  /** Proposed new stage, or null to leave it. */
  stage: StageKey | null
  /** Proposed next step, or null to leave it. */
  nextStep: { text: string; due: string; time: string } | null
  /** How it was worked out: by the connected AI, or by simple keyword rules. */
  via: 'ai' | 'rules'
  /** Shown under the card, e.g. why rules were used instead of AI. */
  note: string
  origin: 'paste' | 'inbox'
  createdAt: string
}

export type IngestResult =
  | { kind: 'proposal'; proposal: EmailProposal }
  /** Already seen; the existing proposal (pending again if it had been dismissed). */
  | { kind: 'duplicate'; proposal: EmailProposal }
  /** No role on the board matches; nothing was sent anywhere. Pass roleId to pick one. */
  | { kind: 'unmatched'; from: string; subject: string }
  /** Matched a role but found nothing to change. */
  | { kind: 'nothing'; roleId: string; company: string; summary: string }

export interface EmailSettings {
  /** Check on launch and every 30 minutes while the app runs. */
  autoCheck: boolean
  /** One OS notification a day when something is due or overdue. Off by default. */
  dailyReminder: boolean
}

export interface EmailStatus {
  connected: boolean
  host: string
  port: number
  user: string
  /** ISO time of the last finished check, or ''. */
  lastCheck: string
  /** Plain summary of the last check ("Looked at 42 new emails; 1 matched a role."). */
  lastResult: string
  lastError: string
  checking: boolean
  /** False when this computer has no keychain, so a password can't be stored safely. */
  canStoreSecrets: boolean
  settings: EmailSettings
}

export interface ConnectRequest {
  host: string
  port: number
  user: string
  /** App password; stored only in the OS keychain. */
  password: string
}

/** Minimum gap between automatic inbox checks. */
export const CHECK_INTERVAL_MS = 30 * 60_000

export interface TodayChannels {
  /** Undone next steps (dated and undated) and recent deadlines of open roles, soonest first. */
  'today:list': { req: void; res: TodayItem[] }
  /** Pending email proposals, newest first. */
  'today:proposals': { req: void; res: EmailProposal[] }
  /** Parse a pasted email or the text of a dropped .eml and propose an update. */
  'today:ingest': { req: { raw: string; roleId?: string }; res: IngestResult }
  /** Applies the proposal (optionally only part of it) through the roles service. */
  'today:applyProposal': { req: { id: string; stage?: boolean; nextStep?: boolean }; res: EmailProposal }
  'today:dismissProposal': { req: { id: string }; res: EmailProposal }
  'today:emailStatus': { req: void; res: EmailStatus }
  /** Tests the connection (read-only), then saves it; the password goes to the keychain. */
  'today:connect': { req: ConnectRequest; res: EmailStatus }
  /** Forgets the connection and deletes the saved password. */
  'today:disconnect': { req: void; res: EmailStatus }
  'today:checkNow': { req: void; res: EmailStatus }
  'today:saveSettings': { req: Partial<EmailSettings>; res: EmailStatus }
}

export interface TodayEvents {
  /** Proposals or inbox status changed. Roles changes come through roles:changed. */
  'today:changed': Record<string, never>
  /** The user clicked the daily reminder; the app switches to the Today view. */
  'today:show': Record<string, never>
}
