import type { NextStep, Role, RolePatch } from '@shared/roles'
import { addDays, localIso } from '@shared/today'
import type { ProposalStore } from './proposals'

/** Next steps across overdue / today / this week / later and one pending email update. TRACKER_DEMO=1 only. */
export function seedTodayDemo(roles: { list(): Role[]; update(id: string, patch: RolePatch): Role }, proposals: ProposalStore): boolean {
  const all = roles.list()
  if (!all.length) return false
  const today = localIso()
  const day = (n: number) => addDays(today, n)
  const find = (company: string) => all.find((r) => r.company === company)
  const step = (text: string, due: string, time = '', source: NextStep['source'] = 'manual'): NextStep => ({ text, due, time, done: false, source })
  const steps: [string, NextStep][] = [
    ['Granitecore', step('Submit the take-home', day(-1), '', 'email')],
    ['Cobaltine AI', step('Technical screen with the inference team', today, '14:00')],
    ['Kite', step('Follow up with the recruiter', today)],
    ['Meridian Compute', step('Decide on the offer', day(3), '17:00')],
    ['Kestrel', step('Ask for a referral', day(5))],
    ['Northwind AI', step('Finish the application', day(9), '', 'chat')],
    ['Tessellate', step('Prepare for the recruiter call', '')],
  ]
  for (const [company, ns] of steps) {
    const r = find(company)
    if (r) roles.update(r.id, { nextStep: ns })
  }
  const vectorline = find('Vectorline')
  if (vectorline && !proposals.byKey('demo:vectorline-assessment')) {
    proposals.add('demo:vectorline-assessment', {
      roleId: vectorline.id,
      company: vectorline.company,
      title: vectorline.title,
      email: { from: 'Vectorline Recruiting <no-reply@ashbyhq.com>', subject: 'Next step: Vectorline online assessment', date: new Date(Date.now() - 2 * 3_600_000).toISOString() },
      summary: 'Vectorline invited you to a 90-minute CodeSignal assessment, due by the end of next week.',
      stage: 'interviewing',
      nextStep: { text: 'Complete the CodeSignal assessment', due: day(6), time: '' },
      via: 'ai',
      note: '',
      origin: 'inbox',
    })
  }
  return true
}
