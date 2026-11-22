import type { Fit } from '@shared/roles'
import type { RefreshResult } from '@shared/search'
import type { Feature } from '../../context'
import { emit, handle } from '../../ipc'
import { runAutosearch } from './autosearch'
import { seedSearchDemo } from './demo'
import { draftFromLink } from './fromLink'
import { CancelledError } from './http'
import { refreshRoles } from './refresh'
import { SuggestionStore, searchMigrations } from './suggestions'
import { detectBoard, loadWatchlist, saveWatchlist } from './watchlist'

/** Turns an AI match score into the board's fit label. Keyword scores are too rough for that. */
function fitFromScore(score: number): Fit {
  return score >= 85 ? 'Strong' : score >= 70 ? 'Good' : score >= 50 ? 'Moderate' : 'Weak'
}

export const searchFeature: Feature = {
  name: 'search',
  migrations: searchMigrations,
  register(ctx) {
    const suggestions = new SuggestionStore(ctx.store)
    const { settings } = ctx
    let running: AbortController | null = null

    handle('search:watchlist', () => loadWatchlist(settings))
    handle('search:saveWatchlist', (list) => saveWatchlist(settings, list))
    handle('search:detectBoard', ({ url }) => detectBoard(url))

    handle('search:run', async () => {
      if (running) throw new Error('Autosearch is already running.')
      const ctrl = new AbortController()
      running = ctrl
      try {
        const out = await runAutosearch({
          watchlist: loadWatchlist(settings),
          profile: ctx.services.profile.get(),
          ai: ctx.services.ai,
          onBoard: (link) => !!ctx.services.roles.findByLink(link),
          settled: suggestions.settledKeys(),
          progress: (p) => emit('search:progress', p),
          signal: ctrl.signal,
        })
        const saved = suggestions.replaceNew(out.suggestions)
        emit('search:progress', { phase: 'done', message: out.summary, done: saved.length, total: saved.length })
        return saved
      } catch (err) {
        if (err instanceof CancelledError || ctrl.signal.aborted) {
          emit('search:progress', { phase: 'done', message: 'Autosearch cancelled. Your earlier suggestions are unchanged.', done: 0, total: 0 })
          return suggestions.list()
        }
        emit('search:progress', { phase: 'error', message: err instanceof Error ? err.message : String(err), done: 0, total: 0 })
        throw err
      } finally {
        running = null
      }
    })
    handle('search:cancel', () => {
      running?.abort()
    })
    handle('search:suggestions', () => suggestions.list())

    handle('search:addSuggestion', ({ id }) => {
      const s = suggestions.get(id)
      if (!s) throw new Error('That suggestion is gone. Run autosearch again.')
      const roles = ctx.services.roles
      const existing = roles.findByLink(s.link)
      const role =
        existing ??
        roles.create({
          company: s.company,
          title: s.title,
          link: s.link,
          location: s.location,
          pay: s.pay ?? '',
          stage: 'saved',
          source: 'autosearch',
          fit: s.rankedBy === 'ai' ? fitFromScore(s.score) : '',
          why: s.rankedBy === 'ai' ? s.reason : '',
        })
      suggestions.setStatus(id, 'added')
      return role
    })
    handle('search:dismissSuggestion', ({ id }) => suggestions.setStatus(id, 'dismissed'))

    handle('search:fromLink', ({ url }) => {
      if (!/^https?:\/\//i.test(url.trim())) throw new Error('Paste a full link that starts with https://')
      return draftFromLink(url.trim(), { ai: ctx.services.ai, profile: () => ctx.services.profile.get() })
    })

    let refreshing: Promise<RefreshResult> | null = null
    handle('search:refresh', () => {
      refreshing ??= refreshRoles({
        roles: ctx.services.roles.list(),
        update: (id, liveness) => ctx.services.roles.update(id, { liveness }),
      }).finally(() => {
        refreshing = null
      })
      return refreshing
    })

    if (process.env['TRACKER_DEMO'] === '1') seedSearchDemo(settings, suggestions)
  },
}
