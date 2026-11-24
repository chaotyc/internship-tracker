import { afterEach, describe, expect, it, vi } from 'vitest'
import { boardUrl } from '@shared/search'
import { fetchBoard, fetchPosting, findBoardInHtml, parseBoardUrl, parsePostingUrl } from './boards'
import { checkLink } from './refresh'
import { detailSaysClosed, fetchWorkdayBoard, parseWorkdaySlug, parseWorkdayUrl, postedOnToDay, withHostSlot } from './workday'

afterEach(() => vi.unstubAllGlobals())

const HOST = 'https://acme.wd5.myworkdayjobs.com'
const API = `${HOST}/wday/cxs/acme/AcmeCareers`
const SITE = { tenant: 'acme', dc: 5, site: 'AcmeCareers' }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const item = (n: number, title = `Thing ${n}`) => ({ title, externalPath: `/job/US-CA-San-Jose/Role_JR${n}`, locationsText: 'US, CA, San Jose', postedOn: 'Posted 2 Days Ago' })
const detail = (n: number, extra: Record<string, unknown> = {}) => ({
  jobPostingInfo: {
    title: `Role ${n}`,
    jobDescription: '<p>About Acme</p><h3>Qualifications</h3><ul><li>Verilog</li></ul>',
    location: 'US, CA, San Jose',
    startDate: '2026-11-18',
    externalUrl: `${HOST}/AcmeCareers/job/US-CA-San-Jose/Role_JR${n}`,
    posted: true,
    ...extra,
  },
})

describe('Workday URLs', () => {
  it('reads careers, locale-prefixed, posting and API links', () => {
    expect(parseWorkdayUrl('https://kestrel.wd5.myworkdayjobs.com/KestrelCareers')).toEqual({ tenant: 'kestrel', dc: 5, site: 'KestrelCareers', path: null })
    expect(parseWorkdayUrl('kestrel.wd5.myworkdayjobs.com/en-US/KestrelCareers/job/US-CA-Santa-Clara/Hardware-Intern_JR1')).toEqual({
      tenant: 'kestrel',
      dc: 5,
      site: 'KestrelCareers',
      path: 'US-CA-Santa-Clara/Hardware-Intern_JR1',
    })
    expect(parseWorkdayUrl('https://intel.wd1.myworkdayjobs.com/External/details/Intern_JR9?q=x')).toMatchObject({ site: 'External', path: 'Intern_JR9' })
    expect(parseWorkdayUrl('https://intel.wd1.myworkdayjobs.com/wday/cxs/intel/External/job/Loc/Intern_JR9')).toMatchObject({ tenant: 'intel', site: 'External', path: 'Loc/Intern_JR9' })
    expect(parseWorkdayUrl('https://intel.wd1.myworkdayjobs.com/')).toBeNull()
    expect(parseWorkdayUrl('https://www.workday.com/en-us/careers')).toBeNull()
  })

  it('becomes board and posting refs with a tenant.wdN/site slug', () => {
    const url = 'https://lumentum.wd5.myworkdayjobs.com/en-US/LITE/job/San-Jose/Optics-Intern_202463'
    expect(parsePostingUrl(url)).toEqual({ board: 'workday', slug: 'lumentum.wd5/LITE', id: 'San-Jose/Optics-Intern_202463' })
    expect(parseBoardUrl(url)).toEqual({ board: 'workday', slug: 'lumentum.wd5/LITE' })
    expect(parseBoardUrl('https://lumentum.wd5.myworkdayjobs.com/LITE')).toEqual({ board: 'workday', slug: 'lumentum.wd5/LITE' })
    expect(parsePostingUrl('https://lumentum.wd5.myworkdayjobs.com/LITE')).toBeNull()
    expect(parseWorkdaySlug('lumentum.wd5/LITE')).toEqual({ tenant: 'lumentum', dc: 5, site: 'LITE' })
    expect(boardUrl({ board: 'workday', slug: 'lumentum.wd5/LITE' })).toBe('https://lumentum.wd5.myworkdayjobs.com/LITE')
  })

  it('finds a Workday site linked from a careers page', () => {
    const html = '<a href="https://marvell.wd1.myworkdayjobs.com/en-US/MarvellCareers">Open roles</a>'
    expect(findBoardInHtml(html)).toEqual({ board: 'workday', slug: 'marvell.wd1/MarvellCareers' })
  })

  it('turns relative posted dates into days, but not "30+ days"', () => {
    const now = new Date('2026-11-21T12:00:00Z')
    expect(postedOnToDay('Posted Today', now)).toBe('2026-11-21')
    expect(postedOnToDay('Posted Yesterday', now)).toBe('2026-11-20')
    expect(postedOnToDay('Posted 3 Days Ago', now)).toBe('2026-11-18')
    expect(postedOnToDay('Posted 30+ Days Ago', now)).toBe('')
  })
})

describe('Workday client', () => {
  it('pages through a search 20 at a time using the first page total, then reads details only for kept postings', async () => {
    const posts: { offset: number; searchText: string }[] = []
    const gets: string[] = []
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST' && url === `${API}/jobs`) {
        const body = JSON.parse(String(init.body)) as { offset: number; limit: number; searchText: string }
        expect(body.limit).toBe(20)
        posts.push({ offset: body.offset, searchText: body.searchText })
        const n = body.offset === 40 ? 5 : 20
        // Like Workday: only the first page carries the real total.
        return json({ total: body.offset === 0 ? 45 : 0, jobPostings: Array.from({ length: n }, (_, i) => item(body.offset + i, (body.offset + i) % 10 === 0 ? `Hardware Intern ${body.offset + i}` : `Senior Engineer ${body.offset + i}`)) })
      }
      gets.push(url)
      const n = Number(/JR(\d+)$/.exec(url)?.[1])
      return json(detail(n))
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchWorkdayBoard(SITE, 'Acme', { search: { queries: ['intern'], keep: (p) => /intern/i.test(p.title) }, now: new Date('2026-11-21T12:00:00Z') })
    expect(posts.map((p) => p.offset)).toEqual([0, 20, 40])
    expect(gets).toHaveLength(5)
    expect(gets[0]).toBe(`${API}/job/US-CA-San-Jose/Role_JR0`)
    expect(out).toHaveLength(5)
    expect(out[0]).toMatchObject({ board: 'workday', company: 'Acme', title: 'Role 0', postedAt: '2026-11-18', url: `${HOST}/AcmeCareers/job/US-CA-San-Jose/Role_JR0` })
    expect(out[0]!.description).toContain('Verilog')
  })

  it('caps pages per query and searches each query once', async () => {
    const offsets: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { offset: number; searchText: string }
        offsets.push(`${body.searchText}@${body.offset}`)
        return json({ total: body.offset === 0 ? 500 : 0, jobPostings: Array.from({ length: 20 }, (_, i) => item(body.offset + i)) })
      }),
    )
    await fetchWorkdayBoard(SITE, 'Acme', { search: { queries: ['intern', 'photonics', 'intern'], maxPages: 2, keep: () => false } })
    expect(offsets).toEqual(['intern@0', 'intern@20', 'photonics@0', 'photonics@20'])
  })

  it('fetchBoard routes Workday slugs to the search client', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: string | URL, init?: RequestInit) => (init?.method === 'POST' ? json({ total: 1, jobPostings: [item(1, 'Optics Intern')] }) : json(detail(1)))))
    const out = await fetchBoard({ board: 'workday', slug: 'acme.wd5/AcmeCareers' }, 'Acme', { workday: { keep: () => true } })
    expect(out.map((p) => p.board)).toEqual(['workday'])
  })

  it('never has more than two requests in flight per host', async () => {
    let active = 0
    let peak = 0
    const task = () =>
      withHostSlot('acme.wd5.myworkdayjobs.com', async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
      })
    await Promise.all(Array.from({ length: 7 }, task))
    expect(peak).toBe(2)
  })
})

describe('Workday closed detection', () => {
  const POSTING = `${HOST}/en-US/AcmeCareers/job/US-CA-San-Jose/Role_JR7`

  it('a 404 detail on a live site means the posting closed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (init?.method === 'POST') return json({ total: 3, jobPostings: [] })
        expect(String(input)).toBe(`${API}/job/US-CA-San-Jose/Role_JR7`)
        return json({ errorCode: 'S21', httpStatus: 404, message: 'not found: Job_Posting_Anchor_ID=Role_JR7' }, 404)
      }),
    )
    expect(await fetchPosting(parsePostingUrl(POSTING)!)).toBeNull()
    expect(await checkLink(POSTING)).toEqual({ state: 'closed', detail: 'The job board no longer lists this posting.' })
  })

  it('a 404 on a site that does not exist is an error, not a closed posting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL, init?: RequestInit) => (init?.method === 'POST' ? json({ errorCode: 'HTTP_422' }, 422) : json({}, 404))),
    )
    await expect(checkLink(POSTING)).rejects.toThrow(/No Workday careers site "AcmeCareers"/)
  })

  it('a detail that says it is no longer available counts as closed', async () => {
    expect(detailSaysClosed(detail(1, { posted: false }))).toBe(true)
    expect(detailSaysClosed(detail(1, { jobDescription: '<p>This job posting is no longer available.</p>' }))).toBe(true)
    expect(detailSaysClosed({})).toBe(true)
    expect(detailSaysClosed(detail(1))).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => json(detail(7, { posted: false }))))
    expect((await checkLink(POSTING)).state).toBe('closed')
  })

  it('a live posting reads as live with its end date as the deadline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(detail(7, { endDate: '2026-12-01' }))))
    expect(await checkLink(POSTING)).toEqual({ state: 'live', detail: 'Still listed on the job board.', deadline: '2026-12-01' })
  })
})
