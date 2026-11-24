import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE, type SearchPreferences } from '@shared/profile'
import { posting } from './fixtures/mockFetch'
import { boilerplateKeywords, excludedBy, filterPostings, isInternshipLike, isNewGradLike, keywordRe, keywordScore, locationFit, matchesLocation, matchesRoleType, matchesTerm, rankByKeywords, termFits, wantedKeywords } from './filter'

const prefs = (p: Partial<SearchPreferences> = {}): SearchPreferences => ({ ...EMPTY_PROFILE.preferences, ...p })

describe('isInternshipLike', () => {
  it('accepts intern, co-op and fellowship titles', () => {
    for (const title of ['ML Intern', 'Software Engineering Internship', 'Co-op, Hardware', 'Northwind Fellows Program', 'Research Residency'])
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
    expect(counts).toEqual({ total: 7, type: 1, term: 1, place: 1, excluded: 1, eligibility: 0, keywords: 1 })
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

describe('role types', () => {
  const p = (title: string, department = '') => ({ title, department })
  it('tells internships, new grad roles and other full-time roles apart', () => {
    expect(isNewGradLike(p('Software Engineer, New Grad 2027'))).toBe(true)
    expect(isNewGradLike(p('Hardware Engineer I'))).toBe(true)
    expect(isNewGradLike(p('Software Engineer', 'University Recruiting'))).toBe(true)
    expect(isNewGradLike(p('Senior Software Engineer', 'University Recruiting'))).toBe(false)
    expect(isNewGradLike(p('Software Engineer II'))).toBe(false)
    expect(isNewGradLike(p('ML Intern'))).toBe(false)
    // A university department holds new grad roles too; those aren't internships.
    expect(isInternshipLike(p('Software Engineer, New Grad', 'University Recruiting'))).toBe(false)
  })
  it('keeps only the wanted types', () => {
    expect(matchesRoleType(p('ML Intern'), ['internship'])).toBe(true)
    expect(matchesRoleType(p('ML Intern'), ['newgrad'])).toBe(false)
    expect(matchesRoleType(p('Software Engineer, New Grad'), ['internship'])).toBe(false)
    expect(matchesRoleType(p('Software Engineer, New Grad'), ['internship', 'newgrad'])).toBe(true)
    expect(matchesRoleType(p('Staff Software Engineer'), ['newgrad'])).toBe(false)
    expect(matchesRoleType(p('Staff Software Engineer'), ['fulltime'])).toBe(true)
  })
})

describe('keyword matching', () => {
  it('matches plurals, singulars and hyphens', () => {
    expect(keywordRe('compiler').test('Work on MLIR compilers.')).toBe(true)
    expect(keywordRe('compilers').test('Compiler Intern')).toBe(true)
    expect(keywordRe('GPU').test('Train models on GPUs')).toBe(true)
    expect(keywordRe('kernel').test('Write fast kernels')).toBe(true)
    expect(keywordRe('deep learning').test('deep-learning systems')).toBe(true)
    expect(keywordRe('C++').test('Strong C++ skills')).toBe(true)
    expect(keywordRe('ML').test('HTML and CSS')).toBe(false)
  })
  it('matches common synonyms', () => {
    expect(keywordRe('ML').test('machine learning models')).toBe(true)
    expect(keywordRe('machine learning').test('ML infrastructure')).toBe(true)
    expect(keywordRe('LLM').test('large language models')).toBe(true)
    expect(keywordRe('compiler').test('Experience with LLVM')).toBe(true)
    expect(keywordRe('photonics').test('photonic integrated circuits')).toBe(true)
  })
  it('keeps postings the old exact-word match dropped', () => {
    const prefs2 = prefs({ targetRoles: ['ML inference intern', 'GPU compiler intern'], keywords: ['CUDA', 'compiler'] })
    const list = [
      posting({ title: 'Compilers Intern', description: 'Work on MLIR compilers.' }),
      posting({ title: 'Machine Learning Intern', description: 'Train and serve machine learning models on GPUs.' }),
    ]
    expect(filterPostings(list, prefs2).kept).toHaveLength(2)
  })
})

describe('places', () => {
  const bay = { locations: ['Bay Area'], remoteOk: false }
  it('keeps locations that name no city, for the AI or you to judge', () => {
    for (const loc of ['2 Locations', 'Multiple Locations', 'United States', 'USA', 'Flexible', ''])
      expect(locationFit(loc, bay), loc).toBe('unclear')
    expect(matchesLocation('2 Locations', bay)).toBe(true)
  })
  it('still drops named places elsewhere', () => {
    expect(locationFit('Austin, TX', bay)).toBe('no')
    expect(locationFit('US, CA, Santa Clara', bay)).toBe('match')
  })
})

describe('skip words', () => {
  it('checks the title, department and requirements, but not the company blurb', () => {
    const desc = 'About us\nWe sell to enterprise sales teams.\n\nRequirements\n- Must be able to obtain a security clearance.'
    expect(excludedBy({ title: 'Sales Intern', department: '' }, ['sales'])).toEqual({ word: 'sales', where: 'the title or department' })
    expect(excludedBy({ title: 'ML Intern', department: '', description: desc }, ['security clearance'])).toEqual({ word: 'security clearance', where: 'the requirements' })
    expect(excludedBy({ title: 'ML Intern', department: '', description: desc }, ['sales'])).toBeNull()
  })
  it('leaves degree words in the requirements to the eligibility check', () => {
    const desc = 'Requirements\n- Currently pursuing a BS, MS or PhD.'
    expect(excludedBy({ title: 'ML Intern', department: '', description: desc }, ['PhD'])).toBeNull()
    expect(excludedBy({ title: 'PhD ML Intern', department: '', description: desc }, ['PhD'])).not.toBeNull()
  })
})

describe('eligibility in the filter', () => {
  it('skips postings limited to a higher degree, and says why', () => {
    const list = [
      posting({ title: 'Research Intern', description: 'Requirements\n- Currently enrolled in a PhD program.' }),
      posting({ title: 'ML Intern', description: 'Requirements\n- Pursuing a BS, MS or PhD.' }),
    ]
    const r = filterPostings(list, prefs(), 'bachelors')
    expect(r.kept.map((p) => p.title)).toEqual(['ML Intern'])
    expect(r.counts.eligibility).toBe(1)
    expect(r.skipped[0]).toMatchObject({ reason: 'eligibility', detail: expect.stringMatching(/at least a PhD/) })
    expect(filterPostings(list, prefs(), 'phd').kept).toHaveLength(2)
  })
})

describe('new grad titles that use "manager", "architect" or "intern"', () => {
  const p = (title: string, department = '') => ({ title, department })
  it('trusts an explicit new grad title or list', () => {
    for (const t of ['Associate Product Manager', 'Product Manager, New Grad 2027', 'Software Engineer - New Grad / Intern', 'DFT Engineer - New College Grad', 'Graduate Talent (Firmware Development)'])
      expect(matchesRoleType(p(t), ['newgrad']), t).toBe(true)
    // The SimplifyJobs new grad list (and boards with a "New Grads" department) vouch for the title.
    expect(matchesRoleType(p('Solutions Architect', 'Software, New grad'), ['newgrad'])).toBe(true)
    expect(isInternshipLike(p('Software Engineer', 'University Departments, New Grads'))).toBe(false)
  })
  it('still drops senior and hiring roles', () => {
    for (const t of ['University Recruiter, New Grads', 'New Grad Program Coordinator', 'Product Manager', 'Software Engineer II'])
      expect(matchesRoleType(p(t), ['newgrad']), t).toBe(false)
    expect(matchesRoleType(p('Senior Software Engineer', 'University Recruiting'), ['newgrad'])).toBe(false)
    expect(matchesRoleType(p('Senior Solutions Architect', 'Software, New grad'), ['newgrad'])).toBe(false)
  })
  it('keeps "Member of Technical Staff" and level 1/2 titles', () => {
    expect(matchesRoleType(p('Member of Technical Staff, New Grad'), ['newgrad'])).toBe(true)
    expect(matchesRoleType(p('Member of Technical Staff', 'Software, New grad'), ['newgrad'])).toBe(true)
    expect(matchesRoleType(p('Electrical Design Engineer 1/2', 'Hardware, New grad'), ['newgrad'])).toBe(true)
    expect(matchesRoleType(p('Senior Signal Processing Engineer New Grad'), ['newgrad'])).toBe(true)
  })
  it('tells interns in a role from staff who run intern programs', () => {
    for (const t of ['Technical Program Manager Intern', 'Recruiting Intern', 'Marketing Coordinator Intern']) expect(isInternshipLike(p(t)), t).toBe(true)
    for (const t of ['Internship Program Manager', 'Intern Coordinator', 'Program Manager, University Internships']) expect(isInternshipLike(p(t)), t).toBe(false)
  })
})

describe('term', () => {
  const p = (title: string, department = '') => ({ title, department })
  it('applies a season to internships only, and a bare year to everything', () => {
    expect(termFits(p('ML Intern - Summer 2026'), 'Summer 2027')).toBe(false)
    expect(termFits(p('Software Engineer New Grad - December 2026'), 'Summer 2027')).toBe(true)
    expect(termFits(p('Software Engineer New Grad 2026'), '2027')).toBe(false)
  })
})

describe('place spellings', () => {
  it('matches the short forms the SimplifyJobs lists use', () => {
    expect(locationFit('SF', { locations: ['San Francisco, CA'], remoteOk: false })).toBe('match')
    expect(locationFit('South SF', { locations: ['Bay Area'], remoteOk: false })).toBe('match')
    expect(locationFit('NYC', { locations: ['New York, NY'], remoteOk: false })).toBe('match')
    expect(locationFit('LA', { locations: ['Los Angeles'], remoteOk: false })).toBe('match')
    expect(locationFit('Bellevue, WA', { locations: ['Seattle, WA'], remoteOk: false })).toBe('match')
  })
  it('matches whole words only', () => {
    expect(locationFit('Atlanta, GA', { locations: ['LA'], remoteOk: false })).toBe('no')
    expect(locationFit('Chicago, IL', { locations: ['CA'], remoteOk: false })).toBe('no')
  })
  it('keeps a bare US state for the AI or you to judge', () => {
    expect(locationFit('California', { locations: ['Bay Area'], remoteOk: false })).toBe('unclear')
    expect(locationFit('Texas, US', { locations: ['Bay Area'], remoteOk: false })).toBe('unclear')
  })
  it('names your places in the reason, not the posting’s', () => {
    const r = filterPostings([posting({ title: 'ML Intern', location: 'Austin, TX' })], prefs({ locations: ['Bay Area', 'NYC'], remoteOk: true }))
    expect(r.skipped[0]).toMatchObject({ reason: 'place', detail: 'Not in Bay Area, NYC or remote' })
  })
})

describe('skip words, edge cases', () => {
  it('never lets a skip word of only dashes or spaces match everything', () => {
    expect(keywordRe('-', { synonyms: false }).test('ML Intern')).toBe(false)
    expect(excludedBy({ title: 'ML Intern', department: 'Research' }, ['-', ' - '])).toBeNull()
  })
  it('ignores a skip word the requirements say is not needed', () => {
    const desc = (line: string) => `Requirements\n- Strong Python and C++.\n- ${line}`
    expect(excludedBy({ title: 'ML Intern', department: '', description: desc('No security clearance required.') }, ['security clearance'])).toBeNull()
    expect(excludedBy({ title: 'ML Intern', department: '', description: desc('US citizenship is not required.') }, ['citizenship'])).toBeNull()
    expect(excludedBy({ title: 'ML Intern', department: '', description: desc('Open to applicants who do not need sponsorship.') }, ['sponsorship'])).not.toBeNull()
    expect(excludedBy({ title: 'ML Intern', department: '', description: desc('Must be able to obtain a security clearance.') }, ['security clearance'])).not.toBeNull()
  })
})
