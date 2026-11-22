import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE } from '@shared/profile'
import { field, greenhouseForm, testProfile } from './fixtures'
import { chooseOption, classify, degreeKind, isProfileEmpty, parseYearMonth, planFill, similarity, type FillAction } from './match'

const NOW = new Date('2026-11-21T12:00:00Z')

function plan(profile = testProfile(), fields = greenhouseForm()) {
  const p = planFill(fields, profile, NOW)
  const byId = new Map<string, FillAction>()
  for (const a of p.actions) byId.set(fields.find((f) => f.key === a.key)!.id, a)
  return { ...p, byId, fields }
}

describe('names and contact details', () => {
  it('fills first, last, preferred name, email and phone by id and autocomplete', () => {
    const { byId } = plan()
    expect(byId.get('first_name')?.value).toBe('Test')
    expect(byId.get('last_name')?.value).toBe('User')
    expect(byId.get('preferred_name')?.value).toBe('Tess')
    expect(byId.get('email')?.value).toBe('test@example.com')
    expect(byId.get('phone')?.value).toBe('+1 555 010 0100')
  })

  it('matches by visible label when ids are opaque', () => {
    const p = testProfile()
    expect(classify(field({ id: 'question_1', label: 'Legal First Name' }), p)?.text).toBe('Test')
    expect(classify(field({ id: 'question_2', label: 'Surname' }), p)?.text).toBe('User')
    expect(classify(field({ id: 'question_3', label: 'Full name' }), p)?.text).toBe('Test User')
    expect(classify(field({ id: 'question_4', label: 'E-mail address' }), p)?.text).toBe('test@example.com')
  })

  it('leaves preferred name empty when none is saved rather than guessing', () => {
    const { byId } = plan(testProfile({ preferredName: '' }))
    expect(byId.has('preferred_name')).toBe(false)
  })

  it('never fills native-language or pronunciation name fields', () => {
    const p = testProfile()
    for (const label of ['Name in native language', 'Full name (in Chinese characters)', 'Last name in your local language', 'Name pronunciation', 'First Name (Kanji)'])
      expect(classify(field({ id: 'question_9', label }), p), label).toBeNull()
    expect(classify(field({ id: 'native_first_name', label: 'First Name' }), p)).toBeNull()
  })

  it('picks the phone country by name, not a longer lookalike', () => {
    const { byId } = plan(testProfile({ country: 'USA' }))
    expect(byId.get('country')?.value).toBe('United States +1')
  })
})

describe('location', () => {
  it('searches the city and picks the option that agrees with the saved region', () => {
    const { byId } = plan()
    const a = byId.get('candidate-location')!
    expect(a.value).toBeUndefined()
    expect(a.search).toBe('Berkeley')
    const options = ['Berkeley, Missouri, United States', 'Berkeley, California, United States', 'Berkeley Heights, New Jersey, United States']
    expect(chooseOption(options, a.want!)).toBe('Berkeley, California, United States')
  })

  it('takes the first city match when only a city is saved, and nothing when the region disagrees', () => {
    const want = { type: 'location', city: 'San Francisco', region: '', country: '' } as const
    expect(chooseOption(['San Francisco, California, United States', 'San Francisco, Cebu, Philippines'], want)).toBe('San Francisco, California, United States')
    expect(chooseOption(['Berkeley, Missouri, United States'], { type: 'location', city: 'Berkeley', region: 'CA', country: 'US' })).toBeNull()
  })
})

describe('links', () => {
  it('fills LinkedIn, website and GitHub from their own profile fields', () => {
    const { byId } = plan()
    expect(byId.get('question_13195393007')?.value).toBe('https://linkedin.com/in/test-user-example')
    expect(byId.get('question_24387192002')?.value).toBe('https://test-user.example.com')
    expect(byId.get('question_9000000001')?.value).toBe('https://github.com/test-user-example')
  })

  it('maps portfolio to the website and skips links the user has not saved', () => {
    const p = testProfile({ github: '' })
    expect(classify(field({ label: 'Portfolio URL' }), p)?.text).toBe('https://test-user.example.com')
    expect(classify(field({ label: 'GitHub' }), p)).toBeNull()
    expect(classify(field({ label: 'Twitter / X profile' }), p)).toBeNull()
  })
})

describe('education', () => {
  it('fills degree, discipline and dates from the first education entry', () => {
    const { byId } = plan()
    expect(byId.get('degree--0')?.value).toBe("Bachelor's Degree")
    expect(byId.get('discipline--0')?.value).toBe('Electrical Engineering and Computer Science')
    expect(byId.get('start-month--0')?.value).toBe('August')
    expect(byId.get('start-year--0')?.value).toBe('2024')
    expect(byId.get('end-month--0')?.value).toBe('May')
    expect(byId.get('end-year--0')?.value).toBe('2027')
  })

  it('searches the school when it is not among the first options', () => {
    const a = plan().byId.get('school--0')!
    expect(a.search).toBe('Example State University')
    expect(chooseOption(['Example State University', 'Example State University - Online'], a.want!)).toBe('Example State University')
    expect(chooseOption(['Stanford University', 'Other'], a.want!)).toBeNull()
  })

  it('matches degree abbreviations to Greenhouse degree names', () => {
    expect(degreeKind('B.S.')).toBe('bachelor')
    expect(degreeKind("Bachelor's Degree")).toBe('bachelor')
    expect(degreeKind('MEng')).toBe('master')
    expect(degreeKind('Master of Business Administration (M.B.A.)')).toBe('mba')
    expect(degreeKind('Ph.D.')).toBe('phd')
    const degrees = greenhouseForm().find((f) => f.id === 'degree--0')!.options
    expect(chooseOption(degrees, { type: 'degree', degree: 'PhD' })).toBe('Doctor of Philosophy (Ph.D.)')
    expect(chooseOption(degrees, { type: 'degree', degree: 'M.S. Computer Science' })).toBe("Master's Degree")
  })

  it('picks the graduation window that contains the saved end date', () => {
    expect(plan().byId.get('question_13253105007')?.value).toBe('May - Aug 2027')
    const late = plan(testProfile({ education: [{ ...testProfile().education[0]!, endDate: '2030-05' }] }))
    expect(late.byId.get('question_13253105007')?.value).toBe('Jan 2029 or later')
    const done = plan(testProfile({ education: [{ ...testProfile().education[0]!, endDate: '2025-05' }] }))
    expect(done.byId.get('question_13253105007')?.value).toBe('Already graduated')
  })

  it('handles season windows like "Earlier than Fall 2027"', () => {
    const opts = ['Earlier than Fall 2027', 'Fall 2027', 'Spring 2028', 'Later than Summer 2028']
    const f = (endDate: string) => planFill([field({ kind: 'combobox', label: 'What is your graduation date?', options: opts })], testProfile({ education: [{ ...testProfile().education[0]!, endDate }] }), NOW).actions[0]?.value
    expect(f('2027-05')).toBe('Earlier than Fall 2027')
    expect(f('2027-12')).toBe('Fall 2027')
    expect(f('2028-05')).toBe('Spring 2028')
    expect(f('2028-07')).toBeUndefined()
    expect(f('2029-05')).toBe('Later than Summer 2028')
  })

  it('picks the GPA band that contains the saved GPA', () => {
    const opts = ['2.4 or below', '2.8 - 3.0 (out of 4.0)', '3.4 - 3.5 (out of 4.0)', '3.6 or above (out of 4.0)', '80% or above (Canadian Institutions)']
    const f = (gpa: string) => planFill([field({ kind: 'combobox', label: 'What is your GPA', options: opts })], testProfile({ education: [{ ...testProfile().education[0]!, gpa }] })).actions[0]?.value
    expect(f('3.7/4.0')).toBe('3.6 or above (out of 4.0)')
    expect(f('3.45')).toBe('3.4 - 3.5 (out of 4.0)')
    expect(f('2.1')).toBe('2.4 or below')
    expect(f('85/100')).toBeUndefined()
    expect(planFill([field({ label: 'GPA' })], testProfile()).actions[0]?.value).toBe('3.7/4.0')
  })

  it('reads the month formats people type', () => {
    expect(parseYearMonth('2027-05')).toEqual({ year: 2027, month: 5 })
    expect(parseYearMonth('05/2027')).toEqual({ year: 2027, month: 5 })
    expect(parseYearMonth('Sept 2027')).toEqual({ year: 2027, month: 9 })
    expect(parseYearMonth('2027')).toEqual({ year: 2027, month: null })
    expect(parseYearMonth('')).toBeNull()
  })
})

describe('work authorization', () => {
  it('answers yes/no selects from the saved booleans', () => {
    const { byId } = plan()
    expect(byId.get('question_13195395007')?.value).toMatch(/^Yes, I am currently legally authorized/)
    expect(byId.get('question_13195396007')?.value).toBe('No')
  })

  it('flips both when the profile says so, and skips when unknown', () => {
    const flipped = plan(testProfile({ authorizedToWorkUS: false, needsSponsorship: true })).byId
    expect(flipped.get('question_13195395007')?.value).toMatch(/^No, I am not/)
    expect(flipped.get('question_13195396007')?.value).toBe('Yes')
    const unknown = plan(testProfile({ authorizedToWorkUS: null, needsSponsorship: null }))
    expect(unknown.byId.has('question_13195395007')).toBe(false)
    expect(unknown.byId.has('question_13195396007')).toBe(false)
    expect(unknown.needsYou).toContain('Will you now or in the future require company sponsorship to retain or extend your employment visa status?')
  })

  it('works with radios and reads "without sponsorship" the right way round', () => {
    const radios = field({ kind: 'radio', label: 'Are you authorized to work in the United States?', options: ['Yes', 'No'] })
    expect(planFill([radios], testProfile()).actions[0]?.value).toBe('Yes')
    const without = field({ kind: 'select', label: 'Are you legally authorized to work in the US without visa sponsorship?', options: ['Yes', 'No'] })
    expect(planFill([without], testProfile()).actions[0]?.value).toBe('Yes')
    expect(planFill([without], testProfile({ needsSponsorship: true })).actions[0]?.value).toBe('No')
  })

  it('does not answer for another country', () => {
    expect(classify(field({ kind: 'select', label: 'Are you legally authorized to work in Canada?', options: ['Yes', 'No'] }), testProfile())).toBeNull()
  })
})

describe('EEO self-identification', () => {
  const eeoIds = ['gender', 'hispanic_ethnicity', 'race', 'veteran_status', 'disability_status', '4012865007', '4012868007']

  it('fills nothing when the user saved no answers', () => {
    const { byId } = plan()
    for (const id of eeoIds) expect(byId.has(id), id).toBe(false)
  })

  it('fills only the answers the user saved', () => {
    const p = testProfile({
      demographics: { gender: 'Female', pronouns: '', hispanicLatino: 'No', race: 'Asian', veteran: 'I am not a protected veteran', disability: '' },
    })
    const { byId } = plan(p)
    expect(byId.get('gender')?.value).toBe('Female')
    expect(byId.get('4012865007')?.value).toBe('Woman')
    expect(byId.get('hispanic_ethnicity')?.value).toBe('No')
    expect(byId.get('race')?.value).toBe('Asian')
    expect(byId.get('veteran_status')?.value).toBe('I am not a protected veteran')
    expect(byId.has('disability_status')).toBe(false)
    // No saved answer exists for this one, even though the label mentions gender.
    expect(byId.has('4012868007')).toBe(false)
  })

  it('does not read "not a protected veteran" as "not a veteran"', () => {
    const p = testProfile({ demographics: { ...EMPTY_PROFILE.demographics, veteran: 'I am not a protected veteran' } })
    const custom = field({ kind: 'combobox', label: 'Are you a veteran or active member of the United States Armed Forces? (select one)', options: ['Yes, I am a veteran or active member', 'No, I am not a veteran or active member', "I don't wish to answer"] })
    expect(planFill([custom], p).actions).toEqual([])
    const yes = testProfile({ demographics: { ...EMPTY_PROFILE.demographics, veteran: 'I identify as one or more of the classifications of protected veteran' } })
    expect(planFill([custom], yes).actions[0]?.value).toBe('Yes, I am a veteran or active member')
  })

  it('maps "decline" to each form\'s own decline option', () => {
    const p = testProfile({
      demographics: { gender: 'decline', pronouns: '', hispanicLatino: 'decline', race: 'decline', veteran: 'decline', disability: 'decline' },
    })
    const { byId } = plan(p)
    expect(byId.get('gender')?.value).toBe('Decline To Self Identify')
    expect(byId.get('hispanic_ethnicity')?.value).toBe('Decline To Self Identify')
    expect(byId.get('race')?.value).toBe('Decline To Self Identify')
    expect(byId.get('veteran_status')?.value).toBe("I don't wish to answer")
    expect(byId.get('disability_status')?.value).toBe('I do not want to answer')
    expect(byId.get('4012865007')?.value).toBe("I don't wish to answer")
  })

  it('matches yes/no style EEO answers worded differently from the form', () => {
    const p = testProfile({
      demographics: { ...EMPTY_PROFILE.demographics, disability: 'No, I do not have a disability and have not had one in the past', veteran: 'I identify as one or more of the classifications of protected veteran' },
    })
    const { byId } = plan(p)
    expect(byId.get('disability_status')?.value).toBe('No, I do not have a disability and have not had one in the past')
    expect(byId.get('veteran_status')?.value).toBe('I identify as one or more of the classifications of a protected veteran')
  })
})

describe('saved answers', () => {
  it('matches custom questions by label similarity', () => {
    const { byId } = plan()
    expect(byId.get('question_24387193002')?.value).toBe('Company careers page')
  })

  it('scores close wordings high and different questions low', () => {
    expect(similarity('How did you hear about this job?', 'How did you hear about us?')).toBeGreaterThanOrEqual(0.7)
    expect(similarity('Earliest start date', 'What is your earliest start date?')).toBeGreaterThanOrEqual(0.7)
    expect(similarity('Are you open to relocation?', 'Are you open to remote work?')).toBeLessThan(0.7)
    expect(similarity('Why Cobaltine AI?', 'How did you hear about us?')).toBe(0)
  })

  it('chooses the matching option for a saved answer on a select', () => {
    const f = field({ kind: 'combobox', label: 'How did you hear about us?', options: ['LinkedIn', 'Company careers page', 'Referral'] })
    expect(planFill([f], testProfile()).actions[0]?.value).toBe('Company careers page')
    const none = field({ kind: 'combobox', label: 'How did you hear about us?', options: ['LinkedIn', 'Referral'] })
    expect(planFill([none], testProfile()).actions).toEqual([])
  })

  it('leaves essays and agreements without a saved answer for the user', () => {
    const { byId, needsYou } = plan()
    expect(byId.has('question_19018743008')).toBe(false)
    expect(byId.has('question_19018752008')).toBe(false)
    expect(needsYou).toEqual(expect.arrayContaining(['Why Cobaltine AI?', 'Agreement to Arbitrate']))
    // The resume is attached separately, so file inputs are never in the plan.
    expect(byId.has('resume')).toBe(false)
  })
})

describe('general rules', () => {
  it('never overwrites a field that already has a value', () => {
    const fields = greenhouseForm().map((f) => (f.id === 'email' ? { ...f, hasValue: true } : f))
    expect(plan(testProfile(), fields).byId.has('email')).toBe(false)
  })

  it('plans nothing from an empty profile', () => {
    expect(isProfileEmpty(EMPTY_PROFILE)).toBe(true)
    expect(isProfileEmpty(testProfile())).toBe(false)
    expect(planFill(greenhouseForm(), EMPTY_PROFILE, NOW).actions).toEqual([])
  })
})
