import type { TodayItem } from '@shared/today'
import type { Feature } from '../../context'
import { handle } from '../../ipc'

// TODO(today feature): email hook, richer list, notifications. This stub derives the list from roles.
export const todayFeature: Feature = {
  name: 'today',
  migrations: [],
  register(ctx) {
    handle('today:list', (): TodayItem[] => {
      const items: TodayItem[] = []
      for (const r of ctx.services.roles.list()) {
        if (r.stage === 'rejected' || r.stage === 'closed') continue
        const base = { roleId: r.id, company: r.company, title: r.title, stage: r.stage }
        if (r.nextStep && !r.nextStep.done && r.nextStep.due)
          items.push({ ...base, kind: 'next-step', text: r.nextStep.text, due: r.nextStep.due, time: r.nextStep.time })
        if (r.deadline) items.push({ ...base, kind: 'deadline', text: 'Application deadline', due: r.deadline, time: '' })
      }
      return items.sort((a, b) => (a.due + a.time).localeCompare(b.due + b.time))
    })
  },
}
