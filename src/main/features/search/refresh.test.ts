import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Liveness, Role } from '@shared/roles'
import { checkLink, livenessFor, refreshRoles } from './refresh'
import { fixture, mockFetch } from './fixtures/mockFetch'

afterEach(() => vi.unstubAllGlobals())

const now = new Date(2026, 10, 21, 10) // Nov 21, 2026 local
const GH = 'https://boards-api.greenhouse.io/v1/boards/acmephotonics'

describe('livenessFor', () => {
  it('closed postings stay closed', () => {
    expect(livenessFor({ state: 'closed', detail: 'gone' }, '2027-01-01', now)).toMatchObject({ status: 'closed', detail: 'gone' })
  })
  it('a deadline within 7 days is expiring; further out is open', () => {
    expect(livenessFor({ state: 'live', detail: 'up' }, '2026-11-28', now)).toMatchObject({ status: 'expiring', detail: 'Applications are due in 7 days (2026-11-28).' })
    expect(livenessFor({ state: 'live', detail: 'up' }, '2026-11-21', now)).toMatchObject({ status: 'expiring', detail: 'Applications are due today.' })
    expect(livenessFor({ state: 'live', detail: 'up' }, '2026-11-29', now)).toMatchObject({ status: 'open', detail: 'up' })
    expect(livenessFor({ state: 'live', detail: 'up' }, '', now)).toMatchObject({ status: 'open' })
  })
  it('uses the board deadline when the role has none, and a past deadline means closed', () => {
    expect(livenessFor({ state: 'live', detail: 'up', deadline: '2026-11-23' }, '', now).status).toBe('expiring')
    expect(livenessFor({ state: 'live', detail: 'up' }, '2026-11-20', now)).toMatchObject({ status: 'closed', detail: 'The deadline (2026-11-20) has passed.' })
  })
  it('stamps the check time', () => {
    expect(livenessFor({ state: 'live', detail: '' }, '', now).checkedAt).toBe(now.toISOString())
  })
})

describe('checkLink', () => {
  it('board API: a missing job means closed, a listed job means live', async () => {
    mockFetch({
      [GH]: JSON.stringify({ name: 'Acme Photonics' }),
      [`${GH}/jobs/4001001`]: fixture('greenhouse-job.json'),
      [`${GH}/jobs/999`]: { status: 404 },
    })
    expect(await checkLink('https://job-boards.greenhouse.io/acmephotonics/jobs/999')).toEqual({ state: 'closed', detail: 'The job board no longer lists this posting.' })
    expect(await checkLink('https://job-boards.greenhouse.io/acmephotonics/jobs/4001001')).toMatchObject({ state: 'live', deadline: '2026-12-15' })
  })

  it('other pages: 404/410 or closed wording means closed', async () => {
    mockFetch({
      'https://acme.com/jobs/gone': { status: 410 },
      'https://acme.com/jobs/missing': { status: 404 },
      'https://acme.com/jobs/closed': fixture('closed-page.html'),
      'https://acme.com/jobs/open': fixture('posting-jsonld.html'),
    })
    expect(await checkLink('https://acme.com/jobs/gone')).toEqual({ state: 'closed', detail: 'The page is gone (410).' })
    expect((await checkLink('https://acme.com/jobs/missing')).state).toBe('closed')
    expect(await checkLink('https://acme.com/jobs/closed')).toMatchObject({ state: 'closed', detail: expect.stringMatching(/no longer accepting applications/) })
    expect(await checkLink('https://acme.com/jobs/open')).toEqual({ state: 'live', detail: 'The page is still up.' })
  })

  it('throws when the page cannot be checked, so nothing is marked closed by mistake', async () => {
    mockFetch({ 'https://acme.com/jobs/down': { status: 503 } })
    await expect(checkLink('https://acme.com/jobs/down')).rejects.toThrow(/503/)
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    await expect(checkLink('https://acme.com/jobs/x')).rejects.toThrow("Couldn't reach acme.com.")
  })
})

function role(p: Partial<Role>): Role {
  return {
    id: 'r',
    trackId: '',
    nextStep: null,
    company: 'Acme',
    title: 'Intern',
    stage: 'saved',
    link: '',
    location: '',
    pay: '',
    deadline: '',
    fit: '',
    priority: '',
    why: '',
    watch: '',
    notes: '',
    postingStatus: '',
    appliedOn: '',
    source: 'manual',
    liveness: { status: 'unknown', checkedAt: null, detail: '' },
    order: 0,
    createdAt: '',
    updatedAt: '',
    ...p,
  }
}

describe('refreshRoles', () => {
  it('checks Saved roles with links only, writes liveness, and sorts results', async () => {
    const roles = [
      role({ id: 'a', company: 'Open Co', link: 'https://x.io/open' }),
      role({ id: 'b', company: 'Closed Co', link: 'https://x.io/closed' }),
      role({ id: 'c', company: 'Soon Co', link: 'https://x.io/open2', deadline: '2026-11-24' }),
      role({ id: 'd', company: 'Down Co', link: 'https://x.io/down' }),
      role({ id: 'e', company: 'No link' }),
      role({ id: 'f', company: 'Applied Co', link: 'https://x.io/closed', stage: 'applied' }),
    ]
    const written = new Map<string, Liveness>()
    const res = await refreshRoles({
      roles,
      now: () => now,
      update: (id, l) => written.set(id, l),
      check: async (link) => {
        if (link.endsWith('closed')) return { state: 'closed', detail: 'gone' }
        if (link.endsWith('down')) throw new Error('x.io took too long to answer.')
        return { state: 'live', detail: 'up' }
      },
    })
    expect(res.checked).toBe(3)
    expect(res.closed).toEqual([{ id: 'b', company: 'Closed Co', title: 'Intern' }])
    expect(res.expiring).toEqual([{ id: 'c', company: 'Soon Co', title: 'Intern', deadline: '2026-11-24' }])
    expect(res.failed).toEqual([{ id: 'd', company: 'Down Co', detail: 'x.io took too long to answer.' }])
    expect([...written.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(written.get('a')!.status).toBe('open')
  })
})
