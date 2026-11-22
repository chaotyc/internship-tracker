import { dayDiff, type TodayItem } from '@shared/today'

/** Earliest local hour the daily reminder may appear. */
export const REMINDER_HOUR = 8

/** Text for the once-a-day "due today" notification, or null when there's nothing due. */
export function reminderText(items: TodayItem[], today: string): { title: string; body: string } | null {
  const due = items.filter((i) => i.due && dayDiff(today, i.due) <= 0)
  if (!due.length) return null
  const overdue = due.filter((i) => i.due < today).length
  const todayN = due.length - overdue
  const parts = [todayN ? `${todayN} due today` : '', overdue ? `${overdue} overdue` : ''].filter(Boolean)
  const lines = due.slice(0, 3).map((i) => `${i.company}: ${i.text}`)
  if (due.length > 3) lines.push(`and ${due.length - 3} more`)
  return { title: parts.join(', ').replace(/^./, (c) => c.toUpperCase()), body: lines.join('\n') }
}

/** Whether the reminder should go out now: switched on, not yet today, and after REMINDER_HOUR. */
export function reminderDue(enabled: boolean, lastShown: string, today: string, now: Date): boolean {
  return enabled && lastShown !== today && now.getHours() >= REMINDER_HOUR
}
