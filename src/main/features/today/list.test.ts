import { describe, expect, it } from 'vitest'
import type { NextStep, StageKey } from '@shared/roles'
import { completeStep, groupToday, nextMonday, sectionOf, snoozeDate, snoozeStep, todayItems, type TodayItem } from '@shared/today'
import { reminderDue, reminderText } from './reminder'

const TODAY = '2026-11-21' // a Saturday
const step = (text: string, due: string, time = '', done = false): NextStep => ({ text, due, time, done, source: 'manual' })
let n = 0
const role = (company: string, stage: StageKey, nextStep: NextStep | null, deadline = '') => ({ id: `r${++n}`, company, title: 'Intern', stage, deadline, nextStep })

describe('todayItems', () => {
  it('lists open next steps (dated and undated) and recent deadlines, skipping finished roles and done steps', () => {
    const items = todayItems(
      [
        role('Vectorline', 'applied', step('Follow up', '2026-11-20')),
        role('Kite', 'saved', null, '2026-11-25'),
        role('Old', 'saved', null, '2026-10-01'), // stale deadline
        role('Gone', 'rejected', step('Nope', TODAY)),
        role('Done', 'interviewing', step('Did it', TODAY, '', true)),
        role('Later', 'interviewing', step('Ask about team', '')),
        role('Offer', 'offer', step('Decide', TODAY, '09:00'), '2026-11-28'),
      ],
      TODAY,
    )
    // Offer's step comes before its deadline, so the deadline rides on the step row instead of its own.
    expect(items.map((i) => `${i.company}:${i.kind}`)).toEqual(['Vectorline:next-step', 'Offer:next-step', 'Kite:deadline', 'Later:next-step'])
    expect(items.find((i) => i.company === 'Kite')!.text).toBe('Application due')
    expect(items.find((i) => i.company === 'Offer')!.deadline).toBe('2026-11-28')
  })

  it('keeps a separate deadline row when the step is later than the deadline', () => {
    const items = todayItems([role('Late', 'offer', step('Decide', '2026-11-30'), '2026-11-28')], TODAY)
    expect(items.map((i) => i.kind)).toEqual(['deadline', 'next-step'])
    expect(items[0]!.text).toBe('Deadline')
  })
})

describe('groupToday', () => {
  const item = (company: string, due: string, time = '', kind: TodayItem['kind'] = 'next-step'): TodayItem => ({
    roleId: company, company, title: 'Intern', stage: 'applied', kind, text: 'x', due, time,
  })

  it('splits into Overdue, Today, This week, Later and No date, in order', () => {
    const groups = groupToday(
      [item('Later', '2026-11-28'), item('Undated', ''), item('Week', '2026-11-27'), item('Over', '2026-11-19'), item('Today', TODAY), item('Tomorrow', '2026-11-22')],
      TODAY,
    )
    expect(groups.map((g) => [g.key, g.items.map((i) => i.company)])).toEqual([
      ['overdue', ['Over']],
      ['today', ['Today']],
      ['week', ['Tomorrow', 'Week']],
      ['later', ['Later']],
      ['undated', ['Undated']],
    ])
  })

  it('orders timed items by time before untimed ones, and next steps before deadlines', () => {
    const [today] = groupToday(
      [item('Deadline', TODAY, '', 'deadline'), item('AllDay', TODAY), item('Late', TODAY, '16:00'), item('Early', TODAY, '09:30')],
      TODAY,
    )
    expect(today!.items.map((i) => i.company)).toEqual(['Early', 'Late', 'AllDay', 'Deadline'])
  })

  it('leaves out empty sections', () => {
    expect(groupToday([], TODAY)).toEqual([])
    expect(sectionOf({ due: '2026-11-27' }, TODAY)).toBe('week')
    expect(sectionOf({ due: '2026-11-28' }, TODAY)).toBe('later')
  })
})

describe('snooze and done', () => {
  it('snoozes to tomorrow or next Monday, keeping the time and reopening it', () => {
    const s = step('Prep', '2026-11-19', '10:00', false)
    expect(snoozeStep(s, 'tomorrow', TODAY)).toEqual({ ...s, due: '2026-11-22' })
    expect(snoozeStep(s, 'next-week', TODAY)).toEqual({ ...s, due: '2026-11-23' })
    expect(snoozeDate('tomorrow', '2026-12-31')).toBe('2027-01-01')
  })

  it('never makes "next week" the same as tomorrow', () => {
    expect(nextMonday('2026-11-22')).toBe('2026-11-30') // Sunday -> the Monday after next
    expect(nextMonday('2026-11-23')).toBe('2026-11-30') // Monday -> a week later
    expect(nextMonday('2026-11-25')).toBe('2026-11-30')
  })

  it('marks a step done without touching the rest', () => {
    const s = step('Prep', TODAY, '10:00')
    expect(completeStep(s)).toEqual({ ...s, done: true })
    expect(todayItems([role('A', 'applied', completeStep(s))], TODAY)).toEqual([])
  })
})

describe('daily reminder', () => {
  const items = todayItems(
    [role('Vectorline', 'applied', step('Follow up', '2026-11-20')), role('Kite', 'applied', step('Call', TODAY)), role('Far', 'applied', step('x', '2026-12-20'))],
    TODAY,
  )

  it('summarises what is due or overdue, and only then', () => {
    expect(reminderText(items, TODAY)).toEqual({ title: '1 due today, 1 overdue', body: 'Vectorline: Follow up\nMeta: Call' })
    expect(reminderText(items.filter((i) => i.company === 'Far'), TODAY)).toBeNull()
  })

  it('goes out at most once a day, after 8am, only when switched on', () => {
    const nine = new Date(2026, 10, 21, 9)
    expect(reminderDue(true, '', TODAY, nine)).toBe(true)
    expect(reminderDue(false, '', TODAY, nine)).toBe(false)
    expect(reminderDue(true, TODAY, TODAY, nine)).toBe(false)
    expect(reminderDue(true, '', TODAY, new Date(2026, 10, 21, 7))).toBe(false)
  })
})
