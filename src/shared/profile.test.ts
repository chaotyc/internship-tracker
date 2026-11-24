import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE, degreeLevelOf, effectiveDegreeLevel, mergeWithDefaults, roleTypesOf } from './profile'

describe('degree level', () => {
  it('reads common degree names', () => {
    expect(degreeLevelOf('B.S.')).toBe('bachelors')
    expect(degreeLevelOf('Bachelor of Science')).toBe('bachelors')
    expect(degreeLevelOf('BA')).toBe('bachelors')
    expect(degreeLevelOf('B.A.')).toBe('bachelors')
    expect(degreeLevelOf('M.S.')).toBe('masters')
    expect(degreeLevelOf('MEng')).toBe('masters')
    expect(degreeLevelOf('Master of Science')).toBe('masters')
    expect(degreeLevelOf('Ph.D.')).toBe('phd')
    expect(degreeLevelOf('PhD')).toBe('phd')
    expect(degreeLevelOf('High school diploma')).toBe(null)
  })

  it('uses the preference, else the highest degree in the education', () => {
    const edu = (...degrees: string[]) => degrees.map((degree) => ({ school: 'X', degree, field: '', startDate: '', endDate: '', gpa: '' }))
    const p = (degreeLevel: '' | 'phd', ...degrees: string[]) => ({ education: edu(...degrees), preferences: { ...EMPTY_PROFILE.preferences, degreeLevel } })
    expect(effectiveDegreeLevel(p('', 'B.S.', 'M.S.'))).toBe('masters')
    expect(effectiveDegreeLevel(p('', 'B.S.'))).toBe('bachelors')
    expect(effectiveDegreeLevel(p('phd', 'B.S.'))).toBe('phd')
    expect(effectiveDegreeLevel(p(''))).toBe(null)
  })
})

describe('role types', () => {
  it('defaults to internships, including for profiles saved before role types existed', () => {
    expect(roleTypesOf(undefined)).toEqual(['internship'])
    expect(roleTypesOf(['fulltime', 'bogus', 'fulltime'])).toEqual(['fulltime'])
    expect(EMPTY_PROFILE.preferences.roleTypes).toEqual(['internship'])
    const old = mergeWithDefaults({ preferences: { targetRoles: ['ML intern'] } })
    expect(old.preferences.roleTypes).toEqual(['internship'])
    expect(old.preferences.degreeLevel).toBe('')
  })
})
