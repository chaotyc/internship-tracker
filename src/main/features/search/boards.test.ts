import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBoard, fetchPosting, findBoardInHtml, parseBoardUrl, parsePostingUrl, titleizeSlug } from './boards'
import { USER_AGENT } from './http'
import { fixture, mockFetch } from './fixtures/mockFetch'

afterEach(() => vi.unstubAllGlobals())

const GH = 'https://boards-api.greenhouse.io/v1/boards/acmephotonics'
const ASHBY = 'https://api.ashbyhq.com/posting-api/job-board/acmechips'
const LEVER = 'https://api.lever.co/v0/postings/acmequantum'

describe('parsePostingUrl', () => {
  it('reads every Greenhouse form', () => {
    expect(parsePostingUrl('https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x')).toEqual({ board: 'greenhouse', slug: 'acme', id: '123' })
    expect(parsePostingUrl('https://boards.greenhouse.io/acme/jobs/123#app')).toEqual({ board: 'greenhouse', slug: 'acme', id: '123' })
    expect(parsePostingUrl('boards.greenhouse.io/acme/jobs/123')).toEqual({ board: 'greenhouse', slug: 'acme', id: '123' })
    expect(parsePostingUrl('https://boards.greenhouse.io/embed/job_app?for=acme&token=456')).toEqual({ board: 'greenhouse', slug: 'acme', id: '456' })
    expect(parsePostingUrl('https://boards-api.greenhouse.io/v1/boards/acme/jobs/789')).toEqual({ board: 'greenhouse', slug: 'acme', id: '789' })
    expect(parsePostingUrl('https://boards.greenhouse.io/acme?gh_jid=321')).toEqual({ board: 'greenhouse', slug: 'acme', id: '321' })
  })

  it('reads embedded ?gh_jid= and ?ashby_jid= links on company sites', () => {
    expect(parsePostingUrl('https://www.acme.com/careers/open-roles?gh_jid=5550001')).toEqual({ board: 'greenhouse', slug: null, id: '5550001' })
    expect(parsePostingUrl('https://acme.ai/jobs?ashby_jid=0B9E7C1A-1111-4C2D-9E3F-5A6B7C8D9E01')).toEqual({
      board: 'ashby',
      slug: null,
      id: '0b9e7c1a-1111-4c2d-9e3f-5a6b7c8d9e01',
    })
  })

  it('reads Ashby and Lever postings, including the apply pages', () => {
    const id = '0b9e7c1a-1111-4c2d-9e3f-5a6b7c8d9e01'
    expect(parsePostingUrl(`https://jobs.ashbyhq.com/acme/${id}`)).toEqual({ board: 'ashby', slug: 'acme', id })
    expect(parsePostingUrl(`https://jobs.ashbyhq.com/acme/${id}/application`)).toEqual({ board: 'ashby', slug: 'acme', id })
    expect(parsePostingUrl(`https://jobs.lever.co/acme/${id}`)).toEqual({ board: 'lever', slug: 'acme', id, eu: false })
    expect(parsePostingUrl(`https://jobs.lever.co/acme/${id}/apply`)).toMatchObject({ board: 'lever', slug: 'acme', id })
    expect(parsePostingUrl(`https://jobs.eu.lever.co/acme/${id}`)).toMatchObject({ eu: true })
  })

  it('ignores board home pages and other sites', () => {
    expect(parsePostingUrl('https://jobs.ashbyhq.com/acme')).toBeNull()
    expect(parsePostingUrl('https://job-boards.greenhouse.io/acme')).toBeNull()
    expect(parsePostingUrl('https://example.com/jobs/123')).toBeNull()
    expect(parsePostingUrl('not a url')).toBeNull()
  })
})

describe('parseBoardUrl and findBoardInHtml', () => {
  it('turns board and posting links into a board', () => {
    expect(parseBoardUrl('https://job-boards.greenhouse.io/cobaltineai')).toEqual({ board: 'greenhouse', slug: 'cobaltineai' })
    expect(parseBoardUrl('https://boards.greenhouse.io/embed/job_board?for=acme')).toEqual({ board: 'greenhouse', slug: 'acme' })
    expect(parseBoardUrl('jobs.ashbyhq.com/vectorline')).toEqual({ board: 'ashby', slug: 'vectorline' })
    expect(parseBoardUrl('https://jobs.lever.co/acme')).toEqual({ board: 'lever', slug: 'acme' })
    expect(parseBoardUrl('https://jobs.lever.co/acme/5c4d3e2f-aaaa-4bbb-8ccc-1d2e3f4a5b6c')).toEqual({ board: 'lever', slug: 'acme' })
    expect(parseBoardUrl('https://acme.com/careers')).toBeNull()
  })

  it('finds a board embedded in a careers page', () => {
    expect(findBoardInHtml('<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>')).toEqual({ board: 'greenhouse', slug: 'acme' })
    expect(findBoardInHtml('<a href="https://job-boards.greenhouse.io/acme/jobs/1">x</a>')).toEqual({ board: 'greenhouse', slug: 'acme' })
    expect(findBoardInHtml('<iframe src="https://jobs.ashbyhq.com/acme/embed"></iframe>')).toEqual({ board: 'ashby', slug: 'acme' })
    expect(findBoardInHtml('<a href="https://jobs.lever.co/acme">Jobs</a>')).toEqual({ board: 'lever', slug: 'acme' })
    expect(findBoardInHtml('<p>No board here</p>')).toBeNull()
  })

  it('titleizes slugs', () => {
    expect(titleizeSlug('cobaltine-ai')).toBe('Cobaltine AI')
  })
})

describe('board clients', () => {
  it('reads a Greenhouse board with a plain User-Agent and normalizes it', async () => {
    const f = mockFetch({ [`${GH}/jobs?content=true`]: fixture('greenhouse-jobs.json') })
    const jobs = await fetchBoard({ board: 'greenhouse', slug: 'acmephotonics' }, 'Acme')
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({
      board: 'greenhouse',
      id: '4001001',
      company: 'Acme Photonics',
      title: 'Photonics Engineering Intern - Summer 2027',
      location: 'Mountain View, CA',
      url: 'https://job-boards.greenhouse.io/acmephotonics/jobs/4001001',
      postedAt: '2026-11-10',
      department: 'Internships',
      deadline: '',
    })
    expect(jobs[0]!.description).toContain('• Simulate silicon photonics devices')
    expect(jobs[0]!.description).not.toContain('<')
    expect(jobs[0]!.compensation).toBe('$48 — $56 USD')
    const headers = f.mock.calls[0]![1]!.headers as Record<string, string>
    expect(headers['User-Agent']).toBe(USER_AGENT)
    expect(USER_AGENT).toMatch(/^InternshipTracker\//)
  })

  it('reads an Ashby board, skipping unlisted jobs, with compensation and remote', async () => {
    mockFetch({ [`${ASHBY}?includeCompensation=true`]: fixture('ashby-board.json') })
    const jobs = await fetchBoard({ board: 'ashby', slug: 'acmechips' }, 'Acme Chips')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      board: 'ashby',
      company: 'Acme Chips',
      title: 'Inference Kernels Intern',
      location: 'San Jose, CA; Remote (US)',
      compensation: '$50 – $60 per hour',
      postedAt: '2026-11-15',
      department: 'Engineering, Inference',
    })
  })

  it('reads a Lever board and formats its salary range', async () => {
    mockFetch({ [`${LEVER}?mode=json`]: fixture('lever-postings.json') })
    const jobs = await fetchBoard({ board: 'lever', slug: 'acmequantum' }, 'Acme Quantum')
    expect(jobs[0]).toMatchObject({
      board: 'lever',
      id: '5c4d3e2f-aaaa-4bbb-8ccc-1d2e3f4a5b6c',
      title: 'Quantum Hardware Intern',
      location: 'Berkeley, CA',
      compensation: '$40–50/hr',
      department: 'Hardware, Intern',
    })
    expect(jobs[0]!.description).toContain('Run cryogenic measurements')
  })

  it('throws a readable error when a board does not exist', async () => {
    mockFetch({})
    await expect(fetchBoard({ board: 'ashby', slug: 'nope' }, 'Nope')).rejects.toThrow(/404/)
  })
})

describe('fetchPosting', () => {
  it('reads one Greenhouse job with pay ranges and deadline', async () => {
    mockFetch({ [`${GH}/jobs/4001001`]: fixture('greenhouse-job.json') })
    const p = await fetchPosting({ board: 'greenhouse', slug: 'acmephotonics', id: '4001001' })
    expect(p).toMatchObject({ compensation: '$48–56/hr', deadline: '2026-12-15', company: 'Acme Photonics' })
  })

  it('returns null when the board lists no such job, and throws when the board is missing', async () => {
    mockFetch({ [GH]: JSON.stringify({ name: 'Acme Photonics' }), [`${GH}/jobs/`]: { status: 404 } })
    expect(await fetchPosting({ board: 'greenhouse', slug: 'acmephotonics', id: '999' })).toBeNull()
    mockFetch({})
    await expect(fetchPosting({ board: 'greenhouse', slug: 'gone', id: '1' })).rejects.toThrow(/No Greenhouse board/)
  })

  it('finds an Ashby job in the board list, or returns null', async () => {
    mockFetch({ [ASHBY]: fixture('ashby-board.json') })
    const p = await fetchPosting({ board: 'ashby', slug: 'acmechips', id: '0b9e7c1a-1111-4c2d-9e3f-5a6b7c8d9e01' })
    expect(p?.title).toBe('Inference Kernels Intern')
    expect(await fetchPosting({ board: 'ashby', slug: 'acmechips', id: '0b9e7c1a-9999-4c2d-9e3f-5a6b7c8d9e09' })).toBeNull()
  })

  it('returns null for a missing Lever posting on a live board', async () => {
    mockFetch({ [`${LEVER}/`]: { status: 404 }, [`${LEVER}?mode=json`]: '[]' })
    expect(await fetchPosting({ board: 'lever', slug: 'acmequantum', id: '5c4d3e2f-aaaa-4bbb-8ccc-000000000000' })).toBeNull()
  })

  it('resolves an embedded ?gh_jid= link through the page that embeds the board', async () => {
    mockFetch({
      'https://acme.com/careers': '<html><script src="https://boards.greenhouse.io/embed/job_board/js?for=acmephotonics"></script></html>',
      [`${GH}/jobs/4001001`]: fixture('greenhouse-job.json'),
    })
    const ref = parsePostingUrl('https://acme.com/careers?gh_jid=4001001')!
    const p = await fetchPosting(ref, { pageUrl: 'https://acme.com/careers?gh_jid=4001001' })
    expect(p?.title).toBe('Photonics Engineering Intern - Summer 2027')
  })
})
