/** Merge-not-replace, per-source pruning, AI gating, sources and the daily scheduler. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }))

import { EMPTY_PROFILE, type ApplicationTrack, type Profile } from '@shared/profile'
import type { WatchCompany } from '@shared/search'
import type { AiService } from '../ai/service'
import { openStore } from '../../db/store'
import { Settings, settingsMigration } from '../../settings'
import { runAutosearch, type AutosearchDeps } from './autosearch'
import type { BoardRef, JobPosting } from './boards'
import { posting } from './fixtures/mockFetch'
import { DAY_MS, LAUNCH_DELAY_MS, TICK_MS, scanDue, startScheduler } from './scheduler'
import type { CachedListing } from './simplify'
import { loadOptions, loadReport, recordReads, saveOptions, saveReport } from './status'
import { SuggestionStore, linkKey, searchMigrations } from './suggestions'

async function store() {
  const s = await openStore(null)
  s.migrate([settingsMigration, ...searchMigrations])
  return s
}

const base = { company: 'Acme', title: 'Intern', location: '', postedAt: '', reason: 'r' }

describe('SuggestionStore.merge', () => {
  it('adds to waiting suggestions instead of replacing them, and prunes only completely read sources', async () => {
    const s = new SuggestionStore(await store())
    s.merge([
      { ...base, link: 'https://x.io/1', score: 50, sourceKey: 'greenhouse:acme' },
      { ...base, link: 'https://x.io/2', score: 60, sourceKey: 'workday:chip.wd1/ext' },
      { ...base, link: 'https://x.io/3', score: 70, sourceKey: 'lever:gone' },
    ])
    const out = s.merge(
      [{ ...base, link: 'https://x.io/4', score: 90, sourceKey: 'greenhouse:acme' }],
      [
        // Acme was read completely and no longer lists /1: it closed.
        { key: 'greenhouse:acme', complete: true, links: new Set([linkKey('https://x.io/4')]) },
        // A Workday search is partial, so /2 stays even though it wasn't in this read.
        { key: 'workday:chip.wd1/ext', complete: false, links: new Set() },
      ],
    )
    expect(out.map((x) => x.link)).toEqual(['https://x.io/4', 'https://x.io/3', 'https://x.io/2'])
  })

  it('keeps dismissed links out, and returns recent dismissals newest first', async () => {
    const s = new SuggestionStore(await store())
    const [a, b] = s.merge([
      { ...base, title: 'Sales Intern', link: 'https://x.io/a', score: 80 },
      { ...base, title: 'Recruiting Intern', link: 'https://x.io/b', score: 70 },
    ])
    s.setStatus(a!.id, 'dismissed')
    await new Promise((r) => setTimeout(r, 5))
    s.setStatus(b!.id, 'dismissed')
    expect(s.recentDismissals()).toEqual([
      { title: 'Recruiting Intern', company: 'Acme' },
      { title: 'Sales Intern', company: 'Acme' },
    ])
    expect(s.merge([{ ...base, link: 'https://x.io/a/', score: 99 }])).toEqual([])
    expect(s.pendingKeys().size).toBe(0)
  })
})

const noAi = {
  complete: async () => {
    throw new Error('No AI connection is set up yet.')
  },
  json: async () => {
    throw new Error('No AI connection is set up yet.')
  },
  status: async () => [],
} as unknown as AiService

const profile: Profile = { ...EMPTY_PROFILE, preferences: { ...EMPTY_PROFILE.preferences, keywords: ['photonics'], term: 'Summer 2027' } }
const watch: WatchCompany[] = [
  { id: '1', name: 'Acme', board: 'greenhouse', slug: 'acme' },
  { id: '2', name: 'Chipco', board: 'workday', slug: 'chipco.wd1/External' },
]
const listing = (p: Partial<CachedListing>): CachedListing => ({
  id: 'x',
  company: 'Lumo',
  title: 'Photonics Intern',
  url: 'https://example.com/lumo/1',
  locations: ['San Jose, CA'],
  terms: ['Summer 2027'],
  category: 'Hardware',
  postedAt: '2026-11-10',
  sponsorship: '',
  ...p,
})

function deps(over: Partial<AutosearchDeps> = {}): AutosearchDeps {
  const data: Record<string, JobPosting[]> = {
    acme: [posting({ company: 'Acme', title: 'Photonics Intern', url: 'https://job-boards.greenhouse.io/acme/jobs/1' })],
    'chipco.wd1/External': [posting({ board: 'workday', company: 'Chipco', title: 'Photonics Test Intern', url: 'https://chipco.wd1.myworkdayjobs.com/External/job/X/Intern_JR1' })],
  }
  return {
    watchlist: watch,
    profile,
    ai: noAi,
    onBoard: () => false,
    settled: new Set(),
    progress: () => {},
    signal: new AbortController().signal,
    fetchBoard: async (ref: BoardRef) => data[ref.slug] ?? [],
    ...over,
  }
}

describe('runAutosearch sources and AI gating', () => {
  it('reads boards and Workday by default, tags each suggestion with its source', async () => {
    const out = await runAutosearch(deps())
    expect(out.suggestions.map((s) => [s.title, s.source, s.sourceKey])).toEqual(
      expect.arrayContaining([
        ['Photonics Intern', 'boards', 'greenhouse:acme'],
        ['Photonics Test Intern', 'workday', 'workday:chipco.wd1/external'],
      ]),
    )
    expect(out.reads.map((r) => [r.key, r.complete])).toEqual(
      expect.arrayContaining([
        ['greenhouse:acme', true],
        ['workday:chipco.wd1/external', false],
      ]),
    )
  })

  it('passes Workday the intern + target-role queries and a title prefilter', async () => {
    const fetchBoard = vi.fn(async () => [] as JobPosting[])
    const p = { ...profile, preferences: { ...profile.preferences, targetRoles: ['Photonics intern'] } }
    await runAutosearch(deps({ fetchBoard, profile: p, watchlist: [watch[1]!] }))
    const opts = (fetchBoard.mock.calls[0] as unknown as [BoardRef, string, { workday: { queries: string[]; keep: (p: JobPosting) => boolean } }])[2]
    expect(opts.workday.queries).toEqual(['intern', 'Photonics intern'])
    expect(opts.workday.keep(posting({ title: 'Staff Photonics Engineer' }))).toBe(false)
    expect(opts.workday.keep(posting({ title: 'Photonics Intern, Summer 2026' }))).toBe(false)
    expect(opts.workday.keep(posting({ title: 'Photonics Intern' }))).toBe(true)
  })

  it('respects source toggles and adds the SimplifyJobs list when on', async () => {
    const loadSimplify = vi.fn(async () => ({ items: [listing({}), listing({ id: 'y', url: 'https://example.com/old', terms: ['Summer 2026'] })], stale: '' }))
    const out = await runAutosearch(deps({ sources: { boards: false, workday: false, simplify: true }, loadSimplify }))
    expect(out.suggestions.map((s) => [s.company, s.source, s.board])).toEqual([['Lumo', 'simplify', undefined]])
    expect(out.reads).toEqual([expect.objectContaining({ key: 'simplify', complete: true, ok: true })])
    expect(out.reads[0]!.links.size).toBe(2)
    expect(out.summary).toMatch(/across the SimplifyJobs list/)
    await expect(runAutosearch(deps({ sources: { boards: false, workday: false, simplify: false } }))).rejects.toThrow(/Every source is turned off/)
  })

  it('reads SimplifyJobs postings from their board before ranking, and drops ones that closed', async () => {
    const loadSimplify = async () => ({
      items: [
        listing({ id: 'a', url: 'https://job-boards.greenhouse.io/lumo/jobs/11' }),
        listing({ id: 'b', title: 'Photonics Intern II', url: 'https://job-boards.greenhouse.io/lumo/jobs/12' }),
      ],
      stale: '',
    })
    const fetchPosting = vi.fn(async (ref: { id: string }) => (ref.id === '12' ? null : posting({ description: 'Requirements\n• Fiber alignment' })))
    const out = await runAutosearch(deps({ sources: { boards: false, workday: false, simplify: true }, loadSimplify, fetchPosting: fetchPosting as never }))
    expect(fetchPosting).toHaveBeenCalledTimes(2)
    expect(out.suggestions.map((s) => s.link)).toEqual(['https://job-boards.greenhouse.io/lumo/jobs/11'])
    expect(out.suggestions[0]!.board).toBe('greenhouse')
  })

  it('makes no AI call when nothing new passed the filter', async () => {
    const json = vi.fn(async () => ({ ranked: [] }))
    const pending = new Set([linkKey('https://job-boards.greenhouse.io/acme/jobs/1'), linkKey('https://chipco.wd1.myworkdayjobs.com/External/job/X/Intern_JR1')])
    const out = await runAutosearch(deps({ ai: { ...noAi, json: json as AiService['json'] }, pending }))
    expect(json).not.toHaveBeenCalled()
    expect(out.aiCalled).toBe(false)
    expect(out.suggestions).toEqual([])
  })

  it('records the best track per suggestion when the user has tracks', async () => {
    const tracks: ApplicationTrack[] = [
      { id: 'ml', name: 'ML', description: '', resume: null, targetRoles: [], keywords: ['CUDA'], answers: [] },
      { id: 'ph', name: 'Photonics', description: '', resume: null, targetRoles: [], keywords: ['photonics'], answers: [] },
    ]
    const out = await runAutosearch(deps({ tracks, profile: { ...profile, tracks } }))
    expect(out.suggestions.every((s) => s.trackId === 'ph' && s.trackName === 'Photonics')).toBe(true)
  })
})

describe('options and board status', () => {
  it('defaults: boards and Workday on, SimplifyJobs and the schedule off', async () => {
    const settings = new Settings(await store())
    expect(loadOptions(settings)).toEqual({ sources: { boards: true, workday: true, simplify: false }, scheduled: false })
    expect(saveOptions(settings, { sources: { simplify: true } as never, scheduled: true })).toEqual({ sources: { boards: true, workday: true, simplify: true }, scheduled: true })
  })

  it('keeps the last success when a board fails, and clears the error on the next success', async () => {
    const settings = new Settings(await store())
    recordReads(settings, [{ key: 'greenhouse:acme', ok: true, error: '' }], new Date('2026-11-20T10:00:00Z'))
    const failed = recordReads(settings, [{ key: 'greenhouse:acme', ok: false, error: 'boards-api.greenhouse.io answered 500.' }], new Date('2026-11-21T10:00:00Z'))
    expect(failed['greenhouse:acme']).toEqual({ lastOk: '2026-11-20T10:00:00.000Z', error: 'boards-api.greenhouse.io answered 500.', errorAt: '2026-11-21T10:00:00.000Z' })
    const ok = recordReads(settings, [{ key: 'greenhouse:acme', ok: true, error: '' }], new Date('2026-11-22T10:00:00Z'))
    expect(ok['greenhouse:acme']).toEqual({ lastOk: '2026-11-22T10:00:00.000Z', error: '', errorAt: null })
  })

  it('saves the skipped report and reads back an older or damaged one without breaking', async () => {
    const settings = new Settings(await store())
    expect(loadReport(settings)).toBeNull()
    const row = { company: 'Acme', title: 'ML Intern', location: 'Austin, TX', link: 'https://x.io/1', reason: 'place' as const, detail: 'Not in Bay Area' }
    const report = { at: '2026-11-20T10:00:00.000Z', total: 3, matched: 1, alreadySeen: 0, counts: { type: 1, term: 0, place: 1, excluded: 0, eligibility: 0, keywords: 0, shortlist: 0 }, skipped: [row] }
    saveReport(settings, report)
    expect(loadReport(settings)).toEqual(report)
    // An older version: no shortlist count, a reason this version doesn't know, a broken row.
    settings.set('search.lastReport', { at: report.at, total: 2, matched: 0, counts: { place: 2 }, skipped: [row, { ...row, reason: 'gone' }, null] })
    expect(loadReport(settings)).toMatchObject({ alreadySeen: 0, counts: { place: 2, shortlist: 0 }, skipped: [row] })
    settings.set('search.lastReport', { skipped: 'nope' })
    expect(loadReport(settings)).toBeNull()
  })
})

describe('scheduler', () => {
  const now = Date.parse('2026-11-21T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('is due only when on, idle, and the last scan is a day old or missing', () => {
    expect(scanDue({ enabled: false, lastScanAt: null, running: false, now })).toBe(false)
    expect(scanDue({ enabled: true, lastScanAt: null, running: false, now })).toBe(true)
    expect(scanDue({ enabled: true, lastScanAt: ago(DAY_MS - 60_000), running: false, now })).toBe(false)
    expect(scanDue({ enabled: true, lastScanAt: ago(DAY_MS), running: false, now })).toBe(true)
    expect(scanDue({ enabled: true, lastScanAt: ago(3 * DAY_MS), running: true, now })).toBe(false)
    expect(scanDue({ enabled: true, lastScanAt: 'garbage', running: false, now })).toBe(true)
  })

  it('catches up after launch, then scans at most once a day', async () => {
    let t = now
    let last: string | null = ago(2 * DAY_MS)
    let enabled = true
    const timers: { fn: () => void; ms: number; every: boolean }[] = []
    const scan = vi.fn(async () => {
      last = new Date(t).toISOString()
    })
    const stop = startScheduler({
      gate: () => ({ enabled, lastScanAt: last, running: false }),
      scan,
      now: () => t,
      setTimeout: (fn, ms) => timers.push({ fn, ms, every: false }),
      setInterval: (fn, ms) => timers.push({ fn, ms, every: true }),
      clearTimeout: () => {},
      clearInterval: () => {},
    })
    const launch = timers.find((x) => !x.every)!
    const hourly = timers.find((x) => x.every)!
    expect([launch.ms, hourly.ms]).toEqual([LAUNCH_DELAY_MS, TICK_MS])
    launch.fn()
    await Promise.resolve()
    expect(scan).toHaveBeenCalledTimes(1)
    for (let h = 1; h < 24; h++) {
      t = now + h * TICK_MS
      hourly.fn()
      await Promise.resolve()
    }
    expect(scan).toHaveBeenCalledTimes(1)
    t = now + DAY_MS
    hourly.fn()
    await Promise.resolve()
    expect(scan).toHaveBeenCalledTimes(2)
    enabled = false
    t = now + 3 * DAY_MS
    hourly.fn()
    expect(scan).toHaveBeenCalledTimes(2)
    stop()
  })
})
