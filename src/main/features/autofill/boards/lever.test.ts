import { describe, expect, it } from 'vitest'
import { leverForm, testProfile } from '../fixtures'
import { chooseOption, type FillAction } from '../match'
import { isGreenhouseApplication } from '../url'
import { adapterFor, applicationUrl, detectLink } from './index'
import { lever, parseLeverLink } from './lever'

const NOW = new Date('2026-11-21T12:00:00')
const JOB = '4e731d11-c3d4-43fd-b292-966129e1bfc2'

function plan(profile = testProfile(), fields = leverForm()) {
  const p = lever.plan(fields, profile, NOW)
  const byName = new Map<string, FillAction>()
  for (const a of p.actions) byName.set(fields.find((f) => f.key === a.key)!.name, a)
  return { ...p, byName }
}

describe('Lever links', () => {
  it('accepts postings and apply pages on jobs.lever.co and jobs.eu.lever.co, opening /apply', () => {
    for (const url of [`https://jobs.lever.co/quanta/${JOB}`, `https://jobs.lever.co/quanta/${JOB}/apply`, `https://jobs.lever.co/quanta/${JOB}/apply?lever-source=LinkedIn`])
      expect(parseLeverLink(url), url).toEqual({ kind: 'hosted', org: 'quanta', jobId: JOB, formUrl: `https://jobs.lever.co/quanta/${JOB}/apply` })
    expect(parseLeverLink(`https://jobs.eu.lever.co/acme/${JOB}`)?.formUrl).toBe(`https://jobs.eu.lever.co/acme/${JOB}/apply`)
  })

  it('rejects job lists, other paths and other hosts', () => {
    for (const url of [
      'https://jobs.lever.co/quanta',
      'https://jobs.lever.co/quanta/123/apply',
      `https://jobs.lever.co/quanta/${JOB}/thanks`,
      `https://api.lever.co/v0/postings/quanta/${JOB}`,
      `https://www.lever.co/quanta/${JOB}`,
      `https://jobs.lever.co.evil.example/quanta/${JOB}`,
    ])
      expect(parseLeverLink(url), url).toBeNull()
  })

  it('detects each board and opens the right application URL', () => {
    const l = detectLink(`https://jobs.lever.co/quanta/${JOB}`)!
    expect(l.board).toBe('lever')
    expect(applicationUrl(l)).toBe(`https://jobs.lever.co/quanta/${JOB}/apply`)
    expect(detectLink('https://job-boards.greenhouse.io/cobaltineai/jobs/5270409007')?.board).toBe('greenhouse')
    expect(detectLink('https://example.com/jobs/1')).toBeNull()
    expect(isGreenhouseApplication(`https://jobs.lever.co/quanta/${JOB}`)).toBe(false)
  })

  it('only trusts https pages on Lever hosts with profile data', () => {
    expect(lever.isFormUrl(`https://jobs.lever.co/quanta/${JOB}/apply`)).toBe(true)
    expect(lever.isFormUrl(`https://jobs.eu.lever.co/acme/${JOB}/apply`)).toBe(true)
    expect(lever.isFormUrl(`http://jobs.lever.co/quanta/${JOB}/apply`)).toBe(false)
    expect(lever.isFormUrl('https://quanta.com/careers')).toBe(false)
    expect(adapterFor('greenhouse').isFormUrl(`https://jobs.lever.co/quanta/${JOB}/apply`)).toBe(false)
    expect(adapterFor('greenhouse').isFormUrl('https://job-boards.greenhouse.io/embed/job_app?for=x&token=1')).toBe(true)
  })
})

describe('Lever field matching', () => {
  it('fills full name, email, phone and links; leaves "Other website" alone', () => {
    const { byName } = plan()
    expect(byName.get('name')?.value).toBe('Test User')
    expect(byName.get('email')?.value).toBe('test@example.com')
    expect(byName.get('phone')?.value).toBe('+1 555 010 0100')
    expect(byName.get('urls[LinkedIn]')?.value).toBe('https://linkedin.com/in/test-user-example')
    expect(byName.get('urls[GitHub]')?.value).toBe('https://github.com/test-user-example')
    expect(byName.get('urls[Portfolio]')?.value).toBe('https://test-user.example.com')
    expect(byName.has('urls[Other]')).toBe(false)
  })

  it("searches Lever's location list for the city and picks the saved state", () => {
    const a = plan().byName.get('location')!
    expect(a.kind).toBe('combobox')
    expect(a.search).toBe('Berkeley')
    expect(chooseOption(['Berkeley, NJ, USA', 'Berkeley, CA, USA', 'Berkeley, MO, USA', 'Berkeley, IL, USA'], a.want!)).toBe('Berkeley, CA, USA')
  })

  it('answers cards only from saved answers and work authorization from the profile', () => {
    const { byName, needsYou } = plan()
    expect(byName.get('cards[052d2626-bf56-45c0-8877-e76519fe4879][field4]')?.value).toBe('Company careers page')
    expect(byName.get('cards[052d2626-bf56-45c0-8877-e76519fe4879][field3]')?.value).toBe('Yes')
    for (const f of ['field0', 'field1', 'field2']) expect(byName.has(`cards[052d2626-bf56-45c0-8877-e76519fe4879][${f}]`)).toBe(false)
    expect(needsYou).toEqual(expect.arrayContaining(['Current company', 'Have you directly operated and maintained a sub-Kelvin cryogenic system (e.g. dilution refrigerators)?']))
  })

  it('leaves the EEO selects and the disability signature empty without saved answers', () => {
    const { byName } = plan()
    for (const n of ['eeo[gender]', 'eeo[race]', 'eeo[veteran]', 'eeo[disability]', 'eeo[disabilitySignature]', 'eeo[disabilitySignatureDate]']) expect(byName.has(n), n).toBe(false)
  })

  it('maps saved EEO answers, decline included, and signs the disability form only alongside a disability answer', () => {
    const { byName } = plan(testProfile({ demographics: { gender: 'Male', pronouns: '', hispanicLatino: '', race: 'decline', veteran: 'decline', disability: 'decline' } }))
    expect(byName.get('eeo[gender]')?.value).toBe('Male')
    expect(byName.get('eeo[race]')?.value).toBe('Decline to self-identify')
    expect(byName.get('eeo[veteran]')?.value).toBe('I decline to self-identify for protected veteran status')
    expect(byName.get('eeo[disability]')?.value).toBe('I do not want to answer')
    expect(byName.get('eeo[disabilitySignature]')?.value).toBe('Test User')
    expect(byName.get('eeo[disabilitySignatureDate]')?.value).toBe('11/21/2026')
  })
})
