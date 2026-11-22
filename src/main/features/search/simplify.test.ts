import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_PROFILE } from '@shared/profile'
import { filterPostings } from './filter'
import { SIMPLIFY_LISTINGS_URL, listingsToPostings, loadSimplifyListings, parseListings, termsMatch, type SimplifyListing } from './simplify'

const now = 1795316462
const listing = (p: Partial<SimplifyListing> = {}): SimplifyListing => ({
  id: Math.random().toString(36).slice(2),
  company_name: 'Photonix',
  title: 'Photonics Engineering Intern',
  url: 'https://job-boards.greenhouse.io/photonix/jobs/123?utm_source=Simplify&ref=Simplify',
  locations: ['San Jose, CA'],
  terms: ['Summer 2027'],
  category: 'Hardware',
  active: true,
  is_visible: true,
  date_posted: now,
  sponsorship: 'Offers Sponsorship',
  ...p,
})

const RAW: SimplifyListing[] = [
  listing({ id: 'a' }),
  listing({ id: 'b', active: false }),
  listing({ id: 'c', is_visible: false }),
  listing({ id: 'd', title: 'Software Engineering Intern', category: 'Software', url: 'https://jobs.lever.co/acme/0f8a2b8e-1234-4abc-9def-0123456789ab' }),
  listing({ id: 'e', terms: ['Summer 2026'], url: 'https://example.com/e' }),
  listing({ id: 'f', terms: ['N/A'], title: 'Optics Intern', locations: ['Austin, TX'], url: 'https://example.com/f' }),
  listing({ id: 'g', url: 'not a link' }),
]

describe('SimplifyJobs listings', () => {
  it('keeps only active, visible entries with a link, trimmed to what the app uses', () => {
    const items = parseListings(RAW)
    expect(items.map((i) => i.id)).toEqual(['a', 'd', 'e', 'f'])
    expect(items[0]).toEqual({
      id: 'a',
      company: 'Photonix',
      title: 'Photonics Engineering Intern',
      url: RAW[0]!.url,
      locations: ['San Jose, CA'],
      terms: ['Summer 2027'],
      category: 'Hardware',
      postedAt: new Date(now * 1000).toISOString().slice(0, 10),
      sponsorship: 'Offers Sponsorship',
    })
    expect(items.find((i) => i.id === 'f')!.terms).toEqual([])
    expect(() => parseListings({ nope: 1 })).toThrow(/expected format/)
  })

  it('matches terms by year and season', () => {
    expect(termsMatch(['Summer 2027'], 'Summer 2027')).toBe(true)
    expect(termsMatch(['Summer 2026'], 'Summer 2027')).toBe(false)
    expect(termsMatch(['Fall 2027'], 'Summer 2027')).toBe(false)
    expect(termsMatch(['Winter 2027', 'Summer 2027'], 'summer 2027')).toBe(true)
    expect(termsMatch([], 'Summer 2027')).toBe(true)
    expect(termsMatch(['Fall 2026'], '')).toBe(true)
  })

  it('filters locally to postings that fit the profile, with board kind from the link', () => {
    const posts = listingsToPostings(parseListings(RAW), 'Summer 2027')
    expect(posts.map((p) => p.id)).toEqual(['a', 'd', 'f'])
    expect(posts[1]!.board).toBe('lever')
    const prefs = { ...EMPTY_PROFILE.preferences, term: 'Summer 2027', locations: ['Bay Area'], keywords: ['photonics', 'optics'] }
    expect(filterPostings(posts, prefs).kept.map((p) => p.id)).toEqual(['a'])
  })
})

describe('loadSimplifyListings', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'simplify-'))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(dir, { recursive: true, force: true })
  })

  it('caches the trimmed list with its ETag and reuses it on 304', async () => {
    const file = join(dir, 'search', 'simplify.json')
    const seen: (string | null)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        expect(String(url)).toBe(SIMPLIFY_LISTINGS_URL)
        const tag = new Headers(init?.headers).get('If-None-Match')
        seen.push(tag)
        if (tag === '"v1"') return new Response(null, { status: 304 })
        return new Response(JSON.stringify(RAW), { status: 200, headers: { etag: '"v1"', 'content-type': 'text/plain' } })
      }),
    )
    const first = await loadSimplifyListings(file)
    expect(first.fromCache).toBe(false)
    expect(first.items).toHaveLength(4)
    const cached = JSON.parse(readFileSync(file, 'utf8')) as { etag: string; items: unknown[] }
    expect(cached.etag).toBe('"v1"')
    expect(cached.items).toHaveLength(4)

    const second = await loadSimplifyListings(file)
    expect(seen).toEqual([null, '"v1"'])
    expect(second).toEqual({ items: first.items, fromCache: true, stale: '' })
  })

  it('falls back to the cache when GitHub is unreachable, and fails without one', async () => {
    const file = join(dir, 'simplify.json')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(RAW), { status: 200, headers: { etag: '"v1"' } })))
    await loadSimplifyListings(file)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const out = await loadSimplifyListings(file)
    expect(out.fromCache).toBe(true)
    expect(out.items).toHaveLength(4)
    expect(out.stale).toMatch(/Couldn't reach raw\.githubusercontent\.com/)
    await expect(loadSimplifyListings(join(dir, 'none.json'))).rejects.toThrow(/Couldn't reach/)
  })
})
