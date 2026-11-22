import { describe, expect, it } from 'vitest'
import type { NextStep, StageKey } from '@shared/roles'
import {
  attentionCount,
  completeStep,
  groupToday,
  itemMatches,
  nextMonday,
  proposalMatches,
  sectionOf,
  snoozeDate,
  snoozeStep,
  todayItems,
  type TodayItem,
} from '@shared/today'
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
        role('Offer', 'offer', step('Decide', '2026-11-23', '09:00'), '2026-11-26'),
      ],
      TODAY,
    )
    // Offer's step comes before its deadline in the same week, so the deadline rides on the step row instead of its own.
    expect(items.map((i) => `${i.company}:${i.kind}`)).toEqual(['Vectorline:next-step', 'Offer:next-step', 'Kite:deadline', 'Later:next-step'])
    expect(items.find((i) => i.company === 'Kite')!.text).toBe('Application due')
    expect(items.find((i) => i.company === 'Offer')!.deadline).toBe('2026-11-26')
  })

  it('folds the deadline only when the step and deadline fall in the same section', () => {
    const items = todayItems(
      [
        role('SameDay', 'applied', step('Call', TODAY, '10:00'), TODAY),
        role('TodayThenWeek', 'applied', step('Prep', TODAY), '2026-11-24'),
        role('OverdueThenToday', 'saved', step('Draft', '2026-11-20'), TODAY),
        role('WeekThenLater', 'applied', step('Email', '2026-11-23'), '2026-12-05'),
      ],
      TODAY,
    )
    const rows = (company: string) => items.filter((i) => i.company === company)
    expect(rows('SameDay').map((i) => [i.kind, i.deadline])).toEqual([['next-step', TODAY]])
    for (const c of ['TodayThenWeek', 'OverdueThenToday', 'WeekThenLater']) {
      expect(rows(c).map((i) => i.kind).sort()).toEqual(['deadline', 'next-step'])
      expect(rows(c).every((i) => i.deadline === undefined)).toBe(true)
    }
    // The deadline due today counts as its own row under Due today.
    const dueToday = groupToday(items, TODAY).find((s) => s.key === 'today')!
    expect(dueToday.label).toBe('Due today')
    expect(dueToday.items.map((i) => `${i.company}:${i.kind}`)).toEqual(['SameDay:next-step', 'TodayThenWeek:next-step', 'OverdueThenToday:deadline'])
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

describe('filter and attention count', () => {
  const item = (company: string, text: string, due = TODAY): TodayItem => ({ roleId: company, company, title: 'ML Intern', stage: 'applied', kind: 'next-step', text, due, time: '' })

  it('matches every word against company, title and step text', () => {
    expect(itemMatches(item('Stripe', 'Follow up'), '')).toBe(true)
    expect(itemMatches(item('Stripe', 'Follow up'), 'stripe')).toBe(true)
    expect(itemMatches(item('Stripe', 'Follow up'), 'ml follow')).toBe(true)
    expect(itemMatches(item('Stripe', 'Follow up'), 'stripe recruiter')).toBe(false)
    const p = { company: 'Ramp', title: 'SWE Intern', summary: 'Invites you to a phone screen.', nextStep: { text: 'Pick a time', due: '', time: '' } }
    expect(proposalMatches(p, 'ramp')).toBe(true)
    expect(proposalMatches(p, 'phone screen')).toBe(true)
    expect(proposalMatches(p, 'pick')).toBe(true)
    expect(proposalMatches({ ...p, nextStep: null }, 'pick')).toBe(false)
  })

  it('counts pending proposals plus overdue and due-today rows', () => {
    const items = [item('A', 'x', '2026-11-19'), item('B', 'x'), item('C', 'x', '2026-11-23'), item('D', 'x', '')]
    expect(attentionCount(items, 2, TODAY)).toBe(4)
    expect(attentionCount([], 0, TODAY)).toBe(0)
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
