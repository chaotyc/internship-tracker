import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deadlineLabel, dueLabel } from './format'

describe('deadlineLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 18, 9, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('reads "Deadline passed" for past dates, never "Due … overdue"', () => {
    expect(deadlineLabel('2026-11-17')).toBe('Deadline passed')
    expect(deadlineLabel('2026-11-10')).toBe('Deadline passed')
  })

  it('prefixes upcoming deadlines with "Due"', () => {
    expect(deadlineLabel('2026-11-18')).toBe('Due today')
    expect(deadlineLabel('2026-11-19')).toBe('Due tomorrow')
    expect(deadlineLabel('2026-12-30')).toBe(`Due ${dueLabel('2026-12-30', '')}`)
  })

  it('keeps step wording for past next steps', () => {
    expect(dueLabel('2026-11-17', '')).toBe('overdue since yesterday')
    expect(dueLabel('2026-11-15', '')).toBe('3 days overdue')
  })
})
