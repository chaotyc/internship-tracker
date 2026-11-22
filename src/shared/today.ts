import type { StageKey } from './roles'

/** One row in the Today view: a dated next step or a posting deadline. */
export interface TodayItem {
  roleId: string
  company: string
  title: string
  stage: StageKey
  kind: 'next-step' | 'deadline'
  text: string
  /** YYYY-MM-DD */
  due: string
  /** HH:MM or '' */
  time: string
}

// The today feature extends these with the email hook's channels.
export interface TodayChannels {
  /** Undone next steps and open deadlines, soonest first (overdue included). */
  'today:list': { req: void; res: TodayItem[] }
}

export interface TodayEvents {
  'today:changed': Record<string, never>
}
