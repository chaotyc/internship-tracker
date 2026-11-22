/** Board stages, in column order. */
export const STAGES = [
  { key: 'saved', label: 'Saved', hint: 'Researched, not sent yet' },
  { key: 'applied', label: 'Applied', hint: 'Waiting to hear back' },
  { key: 'interviewing', label: 'Interviewing', hint: 'Screens, loops, take-homes' },
  { key: 'offer', label: 'Offer', hint: 'Decide and negotiate' },
  { key: 'rejected', label: 'Rejected', hint: 'Turned down' },
  { key: 'closed', label: 'Closed', hint: 'Posting closed or skipped' },
] as const

export type StageKey = (typeof STAGES)[number]['key']
export const STAGE_KEYS: StageKey[] = STAGES.map((s) => s.key)
export type Fit = '' | 'Strong' | 'Good' | 'Moderate' | 'Weak'
export const FITS: Fit[] = ['Strong', 'Good', 'Moderate', 'Weak']

/** Whether a posting is still accepting applications. Written by the refresh feature. */
export interface Liveness {
  status: 'unknown' | 'open' | 'expiring' | 'closed'
  checkedAt: string | null
  detail: string
}

export interface Role {
  id: string
  company: string
  title: string
  stage: StageKey
  link: string
  location: string
  pay: string
  /** ISO date (YYYY-MM-DD) or '' when the posting prints none. */
  deadline: string
  fit: Fit
  priority: string
  why: string
  watch: string
  notes: string
  postingStatus: string
  /** ISO date the application went in, or ''. */
  appliedOn: string
  source: 'manual' | 'autosearch' | 'import' | 'chat'
  liveness: Liveness
  /** Sort key inside a column; lower comes first. */
  order: number
  createdAt: string
  updatedAt: string
}

export type RoleInput = Partial<Omit<Role, 'id' | 'createdAt' | 'updatedAt'>> & {
  company: string
  title: string
}
export type RolePatch = Partial<Omit<Role, 'id' | 'createdAt' | 'updatedAt'>>

export interface RolesChannels {
  'roles:list': { req: void; res: Role[] }
  'roles:create': { req: RoleInput; res: Role }
  'roles:update': { req: { id: string; patch: RolePatch }; res: Role }
  'roles:delete': { req: { id: string }; res: void }
  /** Move a card to a stage and position (index among the other cards in that stage). */
  'roles:move': { req: { id: string; stage: StageKey; index: number }; res: Role }
  /** Import rows from a CSV the user picks; returns how many were added. */
  'roles:importCsv': { req: { csv: string }; res: { added: number; skipped: number } }
}

export interface RolesEvents {
  /** Fired after any change to roles, from any feature. Renderer reloads the list. */
  'roles:changed': { ids: string[] }
}
