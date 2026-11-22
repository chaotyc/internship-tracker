import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_PROFILE, type Profile } from '@shared/profile'
import type { AiRequest } from '@shared/ai'
import type { AiService } from '../ai/service'
import { NO_AI_WARNING, draftFromLink, hasProfileContent, profileForAi } from './fromLink'
import { fixture, mockFetch } from './fixtures/mockFetch'

afterEach(() => vi.unstubAllGlobals())

const noAi: AiService = {
  complete: async () => {
    throw new Error('No AI connection is set up yet. Open Settings, then AI connections.')
  },
  json: async () => {
    throw new Error('No AI connection is set up yet. Open Settings, then AI connections.')
  },
  status: async () => [],
}
const aiReturning = (value: unknown) => {
  const json = vi.fn(async (_req: AiRequest) => value)
  return { ai: { ...noAi, json: json as unknown as AiService['json'] }, json }
}

const withProfile: Profile = {
  ...EMPTY_PROFILE,
  email: 'someone@example.com',
  phone: '555-0100',
  preferences: { ...EMPTY_PROFILE.preferences, targetRoles: ['Photonics intern'], keywords: ['optics'] },
  resume: { fileName: 'r.pdf', storedPath: '/x', text: 'Built a fiber test rig.', updatedAt: '' },
}

describe('draftFromLink', () => {
  it('without AI: returns what JSON-LD says and asks to connect AI', async () => {
    mockFetch({ 'https://acme.com/jobs/42': fixture('posting-jsonld.html') })
    const d = await draftFromLink('https://acme.com/jobs/42', { ai: noAi, profile: () => EMPTY_PROFILE })
    expect(d.role).toMatchObject({
      company: 'Acme Optics',
      title: 'Optical Test Intern',
      location: 'Tucson, AZ',
      pay: '$30–38/hr',
      deadline: '2027-01-31',
      link: 'https://acme.com/jobs/42',
    })
    expect(d.filled.sort()).toEqual(['company', 'deadline', 'location', 'pay', 'title'])
    expect(d.warning).toBe(NO_AI_WARNING)
    expect(d.role.fit).toBeUndefined()
  })

  it('without AI or JSON-LD: falls back to the page title tags, nothing invented', async () => {
    mockFetch({ 'https://acme.com/jobs/7': '<html><head><meta property="og:title" content="Lab Intern"><meta property="og:site_name" content="Acme"></head><body>Hi</body></html>' })
    const d = await draftFromLink('https://acme.com/jobs/7', { ai: noAi, profile: () => EMPTY_PROFILE })
    expect(d.role).toMatchObject({ company: 'Acme', title: 'Lab Intern' })
    expect(d.filled.sort()).toEqual(['company', 'title'])
  })

  it('reads board links through the board API', async () => {
    mockFetch({ 'https://boards-api.greenhouse.io/v1/boards/acmephotonics/jobs/4001001': fixture('greenhouse-job.json') })
    const d = await draftFromLink('https://job-boards.greenhouse.io/acmephotonics/jobs/4001001', { ai: noAi, profile: () => EMPTY_PROFILE })
    expect(d.role).toMatchObject({ company: 'Acme Photonics', title: 'Photonics Engineering Intern - Summer 2027', pay: '$48–56/hr', deadline: '2026-12-15' })
  })

  it('with AI and a profile: fills fit, why and watch, keeps board facts, validates values', async () => {
    mockFetch({ 'https://acme.com/jobs/42': fixture('posting-jsonld.html') })
    const { ai, json } = aiReturning({
      company: 'Wrong Co',
      title: 'Wrong title',
      fit: 'strong',
      why: 'Your fiber test rig matches.',
      watch: 'Check the on-site requirement.',
      postingStatus: 'Open',
      deadline: 'next week',
    })
    const d = await draftFromLink('https://acme.com/jobs/42', { ai, profile: () => withProfile })
    expect(d.role).toMatchObject({ company: 'Acme Optics', title: 'Optical Test Intern', fit: 'Strong', why: 'Your fiber test rig matches.', watch: 'Check the on-site requirement.', postingStatus: 'Open', deadline: '2027-01-31' })
    expect(d.warning).toBe('')
    const prompt = json.mock.calls[0]![0].messages[0]!.content
    expect(prompt).toContain('Built a fiber test rig.')
    expect(prompt).not.toContain('someone@example.com')
    expect(prompt).not.toContain('555-0100')
  })

  it('with AI but no profile: never fills fit, why or watch; only takes a printed YYYY-MM-DD deadline', async () => {
    mockFetch({ 'https://acme.com/jobs/9': '<html><body><h1>Intern</h1><p>Apply by March 1.</p></body></html>' })
    const { ai } = aiReturning({ company: 'Acme', title: 'Intern', fit: 'Good', why: 'x', watch: 'y', deadline: '2027-03-01', pay: '' })
    const d = await draftFromLink('https://acme.com/jobs/9', { ai, profile: () => EMPTY_PROFILE })
    expect(d.role.fit).toBeUndefined()
    expect(d.role.why).toBeUndefined()
    expect(d.role.deadline).toBe('2027-03-01')
    expect(d.filled).not.toContain('pay')
  })

  it('explains closed and unreadable pages', async () => {
    mockFetch({ 'https://acme.com/gone': { status: 404 } })
    await expect(draftFromLink('https://acme.com/gone', { ai: noAi, profile: () => EMPTY_PROFILE })).rejects.toThrow(/doesn't exist anymore/)
    mockFetch({ 'https://boards-api.greenhouse.io/v1/boards/acme': '{"name":"Acme"}', 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/1': { status: 404 } })
    await expect(draftFromLink('https://job-boards.greenhouse.io/acme/jobs/1', { ai: noAi, profile: () => EMPTY_PROFILE })).rejects.toThrow(/no longer lists/)
  })
})

describe('profile helpers', () => {
  it('knows when a profile has content and never sends contact details', () => {
    expect(hasProfileContent(EMPTY_PROFILE)).toBe(false)
    expect(hasProfileContent(withProfile)).toBe(true)
    const text = profileForAi(withProfile)
    expect(text).toContain('Target roles: Photonics intern')
    expect(text).not.toMatch(/example\.com|555/)
  })
})
