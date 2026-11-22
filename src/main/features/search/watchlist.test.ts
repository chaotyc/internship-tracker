import { afterEach, describe, expect, it, vi } from 'vitest'
import { openStore } from '../../db/store'
import { Settings, settingsMigration } from '../../settings'
import { detectBoard, loadWatchlist, saveWatchlist, siteLabel } from './watchlist'
import { mockFetch } from './fixtures/mockFetch'

afterEach(() => vi.unstubAllGlobals())

describe('watchlist storage', () => {
  it('starts empty and de-duplicates by board and slug', async () => {
    const store = await openStore(null)
    store.migrate([settingsMigration])
    const settings = new Settings(store)
    expect(loadWatchlist(settings)).toEqual([])
    const saved = saveWatchlist(settings, [
      { id: 'a', name: 'Vectorline', board: 'ashby', slug: 'vectorline' },
      { id: 'b', name: 'Vectorline again', board: 'ashby', slug: 'Vectorline' },
      { id: 'c', name: '', board: 'lever', slug: 'acme' },
      { id: 'd', name: 'Bad', board: 'workday' as never, slug: 'x' },
    ])
    expect(saved.map((c) => [c.name, c.board, c.slug])).toEqual([
      ['Vectorline', 'ashby', 'vectorline'],
      ['Acme', 'lever', 'acme'],
    ])
    expect(loadWatchlist(settings)).toEqual(saved)
  })
})

describe('detectBoard', () => {
  it('verifies a board URL and names it from the board', async () => {
    mockFetch({ 'https://jobs.ashbyhq.com/acmechips': '<html><head><title>Acme Chips Jobs</title></head></html>' })
    expect(await detectBoard('https://jobs.ashbyhq.com/acmechips')).toMatchObject({ name: 'Acme Chips', board: 'ashby', slug: 'acmechips' })
  })

  it('finds a board embedded in a careers page', async () => {
    mockFetch({
      'https://acme.com/careers': '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acmeco"></script>',
      'https://boards-api.greenhouse.io/v1/boards/acmeco': '{"name":"Acme Co"}',
    })
    expect(await detectBoard('acme.com/careers')).toMatchObject({ name: 'Acme Co', board: 'greenhouse', slug: 'acmeco' })
  })

  it('tries each board for a bare name, and the domain name when the page has no board', async () => {
    mockFetch({ 'https://api.lever.co/v0/postings/acme?mode=json&limit=1': '[]', 'https://jobs.lever.co/acme': '<title>Acme Inc.</title>' })
    expect(await detectBoard('acme')).toMatchObject({ name: 'Acme Inc.', board: 'lever', slug: 'acme' })
    mockFetch({ 'https://careers.widget.io/': '<p>Jobs coming soon</p>', 'https://boards-api.greenhouse.io/v1/boards/widget': '{"name":"Widget"}' })
    expect(await detectBoard('https://careers.widget.io/')).toMatchObject({ board: 'greenhouse', slug: 'widget' })
  })

  it('returns null when no board answers', async () => {
    mockFetch({})
    expect(await detectBoard('https://jobs.ashbyhq.com/nobody')).toBeNull()
    expect(await detectBoard('')).toBeNull()
  })

  it('reads the site name from a URL', () => {
    expect(siteLabel('https://careers.acme.ai/jobs')).toBe('acme')
    expect(siteLabel('https://www.acme.co.uk')).toBe('acme')
  })
})
