import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE, type SearchPreferences } from '@shared/profile'
import { posting } from './fixtures/mockFetch'
import { boilerplateKeywords, filterPostings, isInternshipLike, keywordScore, matchesLocation, matchesTerm, rankByKeywords, wantedKeywords } from './filter'

const prefs = (p: Partial<SearchPreferences> = {}): SearchPreferences => ({ ...EMPTY_PROFILE.preferences, ...p })

describe('isInternshipLike', () => {
  it('accepts intern, co-op and fellowship titles', () => {
    for (const title of ['ML Intern', 'Software Engineering Internship', 'Co-op, Hardware', 'Northwind AI Fellows Program', 'Research Residency'])
      expect(isInternshipLike({ title, department: '' }), title).toBe(true)
  })
  it('rejects staff roles, including ones about interns, and words that only contain "intern"', () => {
    for (const title of ['Senior Engineer', 'International Tax Manager', 'Internal Tools Engineer', 'University Recruiter, Interns'])
      expect(isInternshipLike({ title, department: '' }), title).toBe(false)
  })
  it('trusts an internship department when the title leaves it out', () => {
    expect(isInternshipLike({ title: 'Analog Design', department: 'Internships' })).toBe(true)
    expect(isInternshipLike({ title: 'Senior Analog Design', department: 'University' })).toBe(false)
  })
})

describe('term, location and keywords', () => {
  it('drops titles that name another year or season', () => {
    expect(matchesTerm('Intern - Summer 2027', 'Summer 2027')).toBe(true)
    expect(matchesTerm('Intern - Summer 2026', 'Summer 2027')).toBe(false)
    expect(matchesTerm('Fall 2027 Co-op', 'Summer 2027')).toBe(false)
    expect(matchesTerm('ML Intern', 'Summer 2027')).toBe(true)
    expect(matchesTerm('Intern 2026', '')).toBe(true)
  })

  it('matches cities, the Bay Area and remote', () => {
    const p = { locations: ['Bay Area'], remoteOk: true }
    expect(matchesLocation('Mountain View, CA', p)).toBe(true)
    expect(matchesLocation('Boston, MA; Sunnyvale, CA', p)).toBe(true)
    expect(matchesLocation('Austin, TX', p)).toBe(false)
    expect(matchesLocation('Remote (US)', p)).toBe(true)
    expect(matchesLocation('Remote (US)', { ...p, remoteOk: false })).toBe(false)
    expect(matchesLocation('', p)).toBe(true)
    expect(matchesLocation('Anywhere', { locations: [], remoteOk: false })).toBe(true)
    expect(matchesLocation('New York, NY', { locations: ['New York, NY'], remoteOk: false })).toBe(true)
  })

  it('builds keywords from keywords and target roles, without filler words', () => {
    expect(wantedKeywords({ keywords: ['CUDA'], targetRoles: ['ML inference intern', 'Photonics engineer'] })).toEqual(['CUDA', 'ML', 'inference', 'Photonics'])
  })
})

describe('filterPostings', () => {
  it('keeps matching internships and drops the rest, counting why', () => {
    const list = [
      posting({ title: 'Inference Intern - Summer 2027', location: 'San Jose, CA' }),
      posting({ title: 'Staff Inference Engineer' }),
      posting({ title: 'Inference Intern - Summer 2026' }),
      posting({ title: 'Inference Intern', location: 'London, UK' }),
      posting({ title: 'Inference Sales Intern' }),
      posting({ title: 'Marketing Intern', description: 'Social media.' }),
      posting({ title: 'Platform Intern', description: 'Serve LLM inference at scale.' }),
    ]
    const { kept, counts } = filterPostings(list, prefs({ term: 'Summer 2027', locations: ['Bay Area'], keywords: ['inference'], excludeKeywords: ['sales'] }))
    expect(kept.map((p) => p.title)).toEqual(['Inference Intern - Summer 2027', 'Platform Intern'])
    expect(counts).toEqual({ total: 7, notInternship: 1, wrongTerm: 1, wrongPlace: 1, excluded: 1, noKeyword: 1 })
  })

  it('keeps every internship when no preferences are set', () => {
    expect(filterPostings([posting(), posting({ title: 'Chef' })], prefs()).kept).toHaveLength(1)
  })
})

describe('keyword ranking (no AI)', () => {
  const now = Date.parse('2026-11-21T12:00:00Z')
  const p = prefs({ keywords: ['inference', 'CUDA'], locations: ['San Francisco, CA'], term: 'Summer 2027' })

  it('scores title matches above description matches and explains why', () => {
    const a = keywordScore(posting({ title: 'Inference Intern - Summer 2027', description: 'CUDA kernels' }), p, now)
    const b = keywordScore(posting({ title: 'Platform Intern', description: 'inference serving' }), p, now)
    expect(a.score).toBeGreaterThan(b.score)
    expect(a.score).toBeLessThanOrEqual(100)
    expect(a.reason).toBe('Title mentions inference; description also covers CUDA; in San Francisco, CA; for Summer 2027.')
    expect(keywordScore(posting({ title: 'Intern', location: 'Austin, TX', postedAt: '' }), p, now).reason).toMatch(/no keyword matches/)
  })

  it('ranks best first, caps per company and the total', () => {
    const list = [
      ...Array.from({ length: 12 }, () => posting({ company: 'Big', title: 'Inference Intern' })),
      posting({ company: 'Small', title: 'Platform Intern' }),
    ]
    const ranked = rankByKeywords(list, p, { limit: 9, perCompany: 8, now })
    expect(ranked).toHaveLength(9)
    expect(ranked.filter((r) => r.posting.company === 'Big')).toHaveLength(8)
    expect(ranked[0]!.posting.company).toBe('Big')
    expect(ranked[ranked.length - 1]!.posting.company).toBe('Small')
  })

  it("ignores keywords that sit in a company's boilerplate", () => {
    const list = Array.from({ length: 5 }, (_, i) => posting({ company: 'Optix', title: `Role ${i} Intern`, description: 'We build photonics chips.' }))
    const bp = boilerplateKeywords(list, { keywords: ['photonics'], targetRoles: [] })
    expect(bp.get('Optix')).toEqual(new Set(['photonics']))
    const pp = prefs({ keywords: ['photonics'] })
    expect(keywordScore(list[0]!, pp, now, bp.get('Optix')).score).toBeLessThan(keywordScore(list[0]!, pp, now).score)
  })
})
