import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }))

import { EMPTY_PROFILE, type Profile } from '@shared/profile'
import type { AutosearchProgress, WatchCompany } from '@shared/search'
import type { AiService } from '../ai/service'
import { openStore } from '../../db/store'
import { runAutosearch, type AutosearchDeps } from './autosearch'
import type { BoardRef, JobPosting } from './boards'
import { posting } from './fixtures/mockFetch'
import { SuggestionStore, linkKey, searchMigrations } from './suggestions'

const noAi: AiService = {
  complete: async () => {
    throw new Error('No AI connection is set up yet. Open Settings, then AI connections.')
  },
  json: async () => {
    throw new Error('No AI connection is set up yet. Open Settings, then AI connections.')
  },
  status: async () => [],
}

const watch: WatchCompany[] = [
  { id: '1', name: 'Acme', board: 'greenhouse', slug: 'acme' },
  { id: '2', name: 'Chipco', board: 'ashby', slug: 'chipco' },
  { id: '3', name: 'Broken', board: 'lever', slug: 'broken' },
]

const profile: Profile = { ...EMPTY_PROFILE, preferences: { ...EMPTY_PROFILE.preferences, keywords: ['inference'], term: 'Summer 2027' } }

function boards(): Record<string, JobPosting[]> {
  return {
    acme: [
      posting({ company: 'Acme', title: 'Inference Intern - Summer 2027', url: 'https://job-boards.greenhouse.io/acme/jobs/1' }),
      posting({ company: 'Acme', title: 'Inference Intern - Summer 2026', url: 'https://job-boards.greenhouse.io/acme/jobs/2' }),
      posting({ company: 'Acme', title: 'Staff Inference Engineer', url: 'https://job-boards.greenhouse.io/acme/jobs/3' }),
      posting({ company: 'Acme', title: 'Inference Platform Intern', url: 'https://job-boards.greenhouse.io/acme/jobs/4' }),
    ],
    chipco: [
      posting({ board: 'ashby', company: 'Chipco', title: 'Kernels Intern', description: 'Fast inference kernels.', url: 'https://jobs.ashbyhq.com/chipco/a' }),
      posting({ board: 'ashby', company: 'Chipco', title: 'Dismissed Intern', description: 'inference', url: 'https://jobs.ashbyhq.com/chipco/b' }),
    ],
  }
}

function deps(over: Partial<AutosearchDeps> = {}): AutosearchDeps & { events: AutosearchProgress[] } {
  const events: AutosearchProgress[] = []
  const data = boards()
  return {
    watchlist: watch,
    profile,
    ai: noAi,
    onBoard: (link) => link.endsWith('/jobs/4'),
    settled: new Set([linkKey('https://jobs.ashbyhq.com/chipco/b')]),
    progress: (p) => events.push(p),
    signal: new AbortController().signal,
    fetchBoard: async (ref: BoardRef) => {
      if (!data[ref.slug]) throw new Error('broken.lever.co answered 500.')
      return data[ref.slug]!
    },
    events,
    ...over,
  }
}

describe('runAutosearch', () => {
  it('filters, drops roles on the board or dismissed, and ranks by keywords without AI', async () => {
    const d = deps()
    const out = await runAutosearch(d)
    expect(out.suggestions.map((s) => s.title)).toEqual(['Inference Intern - Summer 2027', 'Kernels Intern'])
    expect(out.rankedBy).toBe('keywords')
    expect(out.suggestions.every((s) => s.rankedBy === 'keywords' && s.reason.length > 0)).toBe(true)
    expect(out.summary).toMatch(/^Found 2 roles across 2 companies\. Checked \d+ postings; skipped /)
    expect(out.summary).toMatch(/Ranked by keyword match; connect an AI provider/)
    expect(out.summary).toMatch(/Couldn't read Broken/)
    expect(out.failed).toEqual([{ company: 'Broken', detail: 'broken.lever.co answered 500.' }])
    const phases = d.events.map((e) => e.phase)
    expect(phases[0]).toBe('fetching')
    expect(phases).toContain('filtering')
    expect(phases).toContain('ranking')
    expect(d.events.filter((e) => e.phase === 'fetching').at(-1)).toMatchObject({ done: 3, total: 3 })
  })

  it('uses one AI call to score and explain, sorted by score', async () => {
    const json = vi.fn(async () => ({ ranked: [{ i: 0, score: 64, reason: 'Okay.' }, { i: 1, score: 91, reason: 'Kernel work fits your CUDA projects.' }, { i: 7, score: 99 }] }))
    const out = await runAutosearch(deps({ ai: { ...noAi, json: json as AiService['json'] } }))
    expect(json).toHaveBeenCalledTimes(1)
    const prompt = (json.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0]!.content
    expect(prompt).toContain('Interested in: inference')
    expect(prompt).not.toMatch(/email|phone/i)
    expect(out.rankedBy).toBe('ai')
    expect(out.suggestions.map((s) => [s.score, s.reason])).toEqual([
      [91, 'Kernel work fits your CUDA projects.'],
      [64, 'Okay.'],
    ])
  })

  it('falls back to keywords and says why when the AI answers badly', async () => {
    const out = await runAutosearch(deps({ ai: { ...noAi, json: (async () => ({ nope: 1 })) as AiService['json'] } }))
    expect(out.rankedBy).toBe('keywords')
    expect(out.summary).toMatch(/AI step failed: The AI reply had no rankings/)
  })

  it('reports every skipped posting with its reason, and counts the ones already seen', async () => {
    const out = await runAutosearch(deps())
    const r = out.report
    expect(r.total).toBe(6)
    expect(r.matched).toBe(2)
    // /jobs/4 is on the board and chipco/b was dismissed.
    expect(r.alreadySeen).toBe(2)
    expect(r.counts).toMatchObject({ type: 1, term: 1 })
    expect(r.skipped.map((s) => [s.title, s.reason])).toEqual(
      expect.arrayContaining([
        ['Staff Inference Engineer', 'type'],
        ['Inference Intern - Summer 2026', 'term'],
      ]),
    )
    expect(r.skipped.find((s) => s.reason === 'term')?.detail).toMatch(/another term than Summer 2027/)
  })

  it('keeps full-time roles when asked, and moves roles the AI rules out into the report', async () => {
    const fullTime: Profile = { ...profile, preferences: { ...profile.preferences, roleTypes: ['internship', 'fulltime'] } }
    const ai: AiService = {
      ...noAi,
      json: (async () => ({
        ranked: [
          { i: 0, score: 80, reason: 'Good fit.' },
          { i: 1, score: 70, reason: 'Fine.' },
          { i: 2, score: 10, reason: 'Needs 8 years of experience.', eligible: false },
        ],
      })) as AiService['json'],
    }
    const out = await runAutosearch(deps({ profile: fullTime, ai }))
    expect(out.report.counts.type).toBe(0)
    expect(out.suggestions).toHaveLength(2)
    const ruledOut = out.report.skipped.filter((s) => s.reason === 'eligibility')
    expect(ruledOut).toHaveLength(1)
    expect(ruledOut[0]!.detail).toBe('The AI ruled it out: Needs 8 years of experience.')
  })

  it('lists postings below the top 40 instead of dropping them silently', async () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      posting({ company: `Co${i}`, title: `Inference Intern ${i}`, url: `https://job-boards.greenhouse.io/many/jobs/9${i}0` }),
    )
    const out = await runAutosearch(deps({ watchlist: [{ id: 'm', name: 'Many', board: 'greenhouse', slug: 'many' }], fetchBoard: async () => many }))
    expect(out.suggestions).toHaveLength(40)
    expect(out.report.counts.shortlist).toBe(5)
    expect(out.report.skipped.filter((s) => s.reason === 'shortlist')).toHaveLength(5)
  })

  it('keeps roles the AI reply leaves out, ranked by keywords, and says so', async () => {
    const ai: AiService = { ...noAi, json: (async () => ({ ranked: [{ i: 1, score: 88, reason: 'Kernel work.' }] })) as AiService['json'] }
    const out = await runAutosearch(deps({ ai }))
    expect(out.suggestions.map((s) => [s.title, s.rankedBy])).toEqual([
      ['Kernels Intern', 'ai'],
      ['Inference Intern - Summer 2027', 'keywords'],
    ])
    expect(out.summary).toMatch(/The AI skipped 1 role; it is ranked by keyword match/)
  })

  it('does not trust an AI reply that rules out every one of several roles', async () => {
    const many = Array.from({ length: 4 }, (_, i) => posting({ company: 'Acme', title: `Inference Intern ${i}`, url: `https://job-boards.greenhouse.io/acme/jobs/7${i}` }))
    const ai: AiService = {
      ...noAi,
      json: (async () => ({ ranked: many.map((_, i) => ({ i, score: 20, reason: 'PhD students only.', eligible: false })) })) as AiService['json'],
    }
    const out = await runAutosearch(deps({ ai, watchlist: [watch[0]!], fetchBoard: async () => many }))
    expect(out.suggestions).toHaveLength(4)
    expect(out.suggestions[0]!.reason).toBe('PhD students only.')
    expect(out.report.counts.eligibility).toBe(0)
    expect(out.summary).toMatch(/likely a mistake, so they're listed anyway/)
  })

  it('reads one copy of a posting that two sources list, preferring the one with a description', async () => {
    const onBoard = posting({ company: 'Acme', title: 'Inference Intern', description: 'Serve inference.', url: 'https://job-boards.greenhouse.io/acme/jobs/55' })
    const out = await runAutosearch(
      deps({
        watchlist: [watch[0]!],
        sources: { boards: true, workday: false, simplify: true },
        fetchBoard: async () => [onBoard],
        fetchPosting: async () => {
          throw new Error('should not be read again')
        },
        loadSimplify: async () => ({
          items: [{ id: 's1', company: 'Acme', title: 'Inference Intern', url: 'https://boards.greenhouse.io/acme/jobs/55?utm_source=Simplify', locations: [], terms: ['Summer 2027'], category: 'AI/ML/Data', postedAt: '', sponsorship: '' }],
          stale: '',
        }),
      }),
    )
    expect(out.report.total).toBe(1)
    expect(out.suggestions).toHaveLength(1)
    expect(out.suggestions[0]).toMatchObject({ source: 'boards', link: onBoard.url })
  })

  it('treats an old profile without role types as looking for internships', async () => {
    const old = { ...profile, preferences: { ...profile.preferences, roleTypes: undefined } } as unknown as Profile
    const out = await runAutosearch(deps({ profile: old }))
    expect(out.suggestions.map((s) => s.title)).toEqual(['Inference Intern - Summer 2027', 'Kernels Intern'])
  })

  it('searches Workday for the keywords when looking only for full-time roles with no target roles', async () => {
    const seen: unknown[] = []
    const fullTime: Profile = { ...profile, preferences: { ...profile.preferences, roleTypes: ['fulltime'], targetRoles: [] } }
    await runAutosearch(
      deps({
        profile: fullTime,
        watchlist: [{ id: 'w', name: 'Chipco', board: 'workday', slug: 'chipco.wd1/External' }],
        fetchBoard: async (_ref, _name, opts) => {
          seen.push(opts?.workday?.queries)
          return [posting({ title: 'Inference Engineer' })]
        },
      }),
    )
    expect(seen).toEqual([['inference']])
  })

  it('keeps the saved report small: long fields are clipped', async () => {
    const far = posting({ company: 'Acme', title: 'Inference Intern', location: Array.from({ length: 40 }, (_, i) => `City ${i}, Far Away`).join('; '), url: 'https://job-boards.greenhouse.io/acme/jobs/66' })
    const out = await runAutosearch(deps({ watchlist: [watch[0]!], fetchBoard: async () => [far], profile: { ...profile, preferences: { ...profile.preferences, locations: ['Bay Area'] } } }))
    const row = out.report.skipped.find((s) => s.reason === 'place')!
    expect(row.location.length).toBeLessThanOrEqual(120)
    expect(row.location.endsWith('…')).toBe(true)
  })

  it('asks for companies when the watchlist is empty, and fails when no board can be read', async () => {
    await expect(runAutosearch(deps({ watchlist: [] }))).rejects.toThrow(/Settings → Job boards/)
    await expect(runAutosearch(deps({ watchlist: [watch[2]!] }))).rejects.toThrow(/Couldn't read any job boards/)
  })

  it('stops when cancelled', async () => {
    const ctrl = new AbortController()
    const d = deps({
      signal: ctrl.signal,
      fetchBoard: async () => {
        ctrl.abort()
        return []
      },
    })
    await expect(runAutosearch(d)).rejects.toThrow('Cancelled.')
  })
})

describe('SuggestionStore', () => {
  it('replaces open suggestions but remembers added and dismissed links', async () => {
    const store = await openStore(null)
    store.migrate(searchMigrations)
    const s = new SuggestionStore(store)
    const base = { company: 'Acme', title: 'Intern', location: '', postedAt: '', reason: 'r' }
    const first = s.replaceNew([
      { ...base, link: 'https://x.io/1', score: 50 },
      { ...base, link: 'https://x.io/2', score: 80 },
    ])
    expect(first.map((x) => x.score)).toEqual([80, 50])
    s.setStatus(first[0]!.id, 'dismissed')
    expect(s.settledKeys()).toEqual(new Set([linkKey('https://x.io/2')]))
    const second = s.replaceNew([
      { ...base, link: 'https://x.io/2/', score: 99 },
      { ...base, link: 'https://x.io/3', score: 10 },
    ])
    expect(second.map((x) => x.link)).toEqual(['https://x.io/3'])
    expect(s.list('dismissed')).toHaveLength(1)
  })
})
