import { describe, expect, it } from 'vitest'
import { ashbyForm, testProfile } from '../fixtures'
import { chooseOption, type FillAction } from '../match'
import { ashby, ashbyOrgFromHtml, parseAshbyLink } from './ashby'
import { detectLink } from './index'

const NOW = new Date('2026-11-21T12:00:00Z')
const JOB = '639fe410-56a4-44aa-ac93-8ee7c10c7d75'

function plan(profile = testProfile(), fields = ashbyForm()) {
  const p = ashby.plan(fields, profile, NOW)
  const byLabel = new Map<string, FillAction>()
  for (const a of p.actions) byLabel.set(fields.find((f) => f.key === a.key)!.label, a)
  return { ...p, byLabel }
}

describe('Ashby links', () => {
  it('accepts postings and application pages, opening the application', () => {
    for (const url of [`https://jobs.ashbyhq.com/Vectorline/${JOB}`, `https://jobs.ashbyhq.com/Vectorline/${JOB}/application`, `https://jobs.ashbyhq.com/Vectorline/${JOB}/application?utm_source=x`])
      expect(parseAshbyLink(url), url).toEqual({ kind: 'hosted', org: 'Vectorline', jobId: JOB, formUrl: `https://jobs.ashbyhq.com/Vectorline/${JOB}/application` })
    expect(parseAshbyLink(`https://jobs.ashbyhq.com/vectorline?ashby_jid=${JOB}`)).toMatchObject({ kind: 'hosted', org: 'vectorline', jobId: JOB })
  })

  it('accepts company pages that embed Ashby with ashby_jid and guesses the org from the host', () => {
    expect(parseAshbyLink(`https://www.notion.com/careers?ashby_jid=${JOB}`)).toEqual({
      kind: 'company',
      jobId: JOB,
      pageUrl: `https://www.notion.com/careers?ashby_jid=${JOB}`,
      orgGuesses: ['notion'],
    })
  })

  it('rejects job boards, other paths and non-Ashby hosts', () => {
    for (const url of [
      'https://jobs.ashbyhq.com/vectorline',
      'https://jobs.ashbyhq.com/vectorline/1',
      `https://jobs.ashbyhq.com/api/${JOB}`,
      `https://jobs.ashbyhq.com/vectorline/${JOB}/something`,
      `https://jobs.ashbyhq.com.evil.example/vectorline/${JOB}`,
      'https://www.notion.com/careers?ashby_jid=123',
      `ftp://jobs.ashbyhq.com/vectorline/${JOB}`,
    ])
      expect(parseAshbyLink(url), url).toBeNull()
  })

  it('reads the org from an embed script or iframe', () => {
    expect(ashbyOrgFromHtml('<script src="https://jobs.ashbyhq.com/notion/embed?version=2"></script>')).toBe('notion')
    expect(ashbyOrgFromHtml('<iframe id="ashby_embed_iframe" src="https://jobs.ashbyhq.com/ramp/embed?ashby_jid=x"></iframe>')).toBe('ramp')
    expect(ashbyOrgFromHtml('<a href="https://jobs.ashbyhq.com/api/foo">x</a>')).toBeNull()
  })

  it('is detected as the ashby board and reported by autofill:supported', () => {
    expect(detectLink(`https://jobs.ashbyhq.com/Vectorline/${JOB}`)?.board).toBe('ashby')
    expect(detectLink(`https://www.notion.com/careers?ashby_jid=${JOB}`)?.board).toBe('ashby')
  })

  it('only trusts https pages on jobs.ashbyhq.com with profile data', () => {
    expect(ashby.isFormUrl(`https://jobs.ashbyhq.com/Vectorline/${JOB}/application`)).toBe(true)
    for (const url of [
      `http://jobs.ashbyhq.com/Vectorline/${JOB}/application`,
      `https://jobs.ashbyhq.com.evil.example/Vectorline/${JOB}/application`,
      `https://evil.example/jobs.ashbyhq.com/Vectorline/${JOB}`,
      `https://user:pw@jobs.ashbyhq.com/Vectorline/${JOB}`,
      'https://www.notion.com/careers',
      'about:blank',
    ])
      expect(ashby.isFormUrl(url), url).toBe(false)
  })
})

describe('Ashby field matching', () => {
  it('fills the name, contact details and links', () => {
    const { byLabel } = plan()
    expect(byLabel.get('Name')?.value).toBe('Test User')
    expect(byLabel.get('Preferred Name')?.value).toBe('Tess')
    expect(byLabel.get('Email')?.value).toBe('test@example.com')
    expect(byLabel.get('Phone Number')?.value).toBe('+1 555 010 0100')
    expect(byLabel.get('LinkedIn Profile URL')?.value).toBe('https://linkedin.com/in/test-user-example')
    expect(byLabel.get('GitHub or Portfolio URL')?.value).toBe('https://github.com/test-user-example')
  })

  it('never fills a native-language name', () => {
    expect(plan().byLabel.has('Name in native language (if applicable)')).toBe(false)
  })

  it('searches the location autocomplete for the city and picks the saved region', () => {
    const a = plan().byLabel.get('Current Location')!
    expect(a.search).toBe('Berkeley')
    const options = ['Berkeley, California, United States', 'Berkeley Springs, West Virginia, United States', 'Berkeley Heights, New Jersey, United States', 'Berkeley, Missouri, United States']
    expect(chooseOption(options, a.want!)).toBe('Berkeley, California, United States')
  })

  it('fills school, major and GPA, and the education-history block', () => {
    const { byLabel } = plan()
    expect(byLabel.get('College or University')?.value).toBe('Example State University')
    expect(byLabel.get('Major or Field of Study')?.value).toBe('Electrical Engineering and Computer Science')
    expect(byLabel.get('Current GPA')?.value).toBe('3.7/4.0')
    expect(byLabel.get('School')?.search).toBe('Example State University')
    expect(byLabel.get('Degree')?.value).toBe('B.S.')
    expect(byLabel.get('Field of Study')?.value).toBe('Electrical Engineering and Computer Science')
    expect(byLabel.get('Start date month')?.value).toBe('August')
    expect(byLabel.get('Start date year')?.value).toBe('2024')
    expect(byLabel.get('End date month')?.value).toBe('May')
    expect(byLabel.get('End date year')?.value).toBe('2027')
  })

  it('answers work authorization and sponsorship only where the options say yes or no', () => {
    const { byLabel, needsYou } = plan()
    expect(byLabel.get('Are you legally authorized to work in the United States?')?.value).toMatch(/^YES: /)
    expect(byLabel.get('Are you authorized to work lawfully in the United States?')?.value).toBe('Yes')
    expect(byLabel.get('Will you now or in the future require employer sponsorship for employment visa status (e.g., H-1B)?')?.value).toBe('NO')
    // Visa types aren't a yes/no answer, and other countries' sponsorship isn't what the profile says.
    const opt = 'Will you now or at any time in the future require sponsorship for employment visa status (e.g. H1B, OPT)?'
    const uk = 'Will you now or in the future require sponsorship for employment visa status in the United Kingdom, Germany or Serbia?'
    expect(byLabel.has(opt)).toBe(false)
    expect(byLabel.has(uk)).toBe(false)
    expect(needsYou).toEqual(expect.arrayContaining([opt, uk]))
  })

  it('leaves a month-precision graduation for a day-precision date picker, but fills a saved full date', () => {
    const p = testProfile({ answers: [{ id: 's', question: 'When can you start a new role?', answer: 'May 26, 2027' }] })
    const { byLabel, needsYou } = plan(p)
    expect(byLabel.has('Expected Graduation Date')).toBe(false)
    expect(needsYou).toContain('Expected Graduation Date')
    expect(byLabel.get('When can you start a new role?')).toMatchObject({ kind: 'date', value: '2027-05-26' })
  })

  it('answers Yes/No buttons and custom questions only from saved answers', () => {
    const q = 'Are you able to work in-person in San Jose this summer?'
    expect(plan().byLabel.has(q)).toBe(false)
    const p = testProfile({
      answers: [
        { id: 'a', question: 'Are you able to work in person in San Jose this summer?', answer: 'Yes' },
        { id: 'b', question: 'SAT or ACT score', answer: '1540 SAT' },
      ],
    })
    const { byLabel } = plan(p)
    expect(byLabel.get(q)?.value).toBe('Yes')
    expect(byLabel.get('SAT or ACT Score')?.value).toBe('1540 SAT')
    expect(byLabel.has('Why do you want to join Vectorline?')).toBe(false)
    expect(byLabel.has('How did you hear about Vectorline?')).toBe(false)
  })

  it('fills EEO answers only from saved values, with decline mapped to the decline option', () => {
    for (const l of ['Gender', 'Race', 'Veteran Status']) expect(plan().byLabel.has(l), l).toBe(false)
    const { byLabel } = plan(testProfile({ demographics: { gender: 'Female', pronouns: '', hispanicLatino: '', race: 'decline', veteran: 'I am not a protected veteran', disability: '' } }))
    expect(byLabel.get('Gender')?.value).toBe('Female')
    expect(byLabel.get('Race')?.value).toBe('Decline to self-identify')
    expect(byLabel.get('Veteran Status')?.value).toBe('I am not a protected veteran')
  })

  it('lists required fields it could not fill and never the resume', () => {
    const { needsYou } = plan()
    expect(needsYou).toEqual(expect.arrayContaining(['Why do you want to join Vectorline?', 'Current Program Type', 'Which term(s) would you like to be considered for?']))
    expect(needsYou).not.toContain('Resume')
  })
})
