import { join } from 'node:path'
import { DEFAULT_TRACK_ID } from '@shared/profile'
import { fitFromScore, type RefreshResult, type Suggestion } from '@shared/search'
import type { Feature } from '../../context'
import { emit, handle } from '../../ipc'
import { isHeadless } from '../../headless'
import { runAutosearch } from './autosearch'
import { seedSearchDemo } from './demo'
import { draftFromLink } from './fromLink'
import { CancelledError } from './http'
import { refreshRoles } from './refresh'
import { startScheduler } from './scheduler'
import { loadSimplifyListings } from './simplify'
import { loadLastScan, loadOptions, recordReads, saveLastScan, saveOptions, statusOf } from './status'
import { SuggestionStore, searchMigrations } from './suggestions'
import { detectBoard, loadWatchlist, saveWatchlist } from './watchlist'

export const searchFeature: Feature = {
  name: 'search',
  migrations: searchMigrations,
  register(ctx) {
    const suggestions = new SuggestionStore(ctx.store)
    const { settings } = ctx
    const simplifyCache = join(ctx.dataDir, 'search', 'simplify-listings.json')
    let running: { ctrl: AbortController; scheduled: boolean } | null = null
    const status = () => statusOf(settings, !!running)
    const pushStatus = () => emit('search:statusChanged', status())

    /** One scan of every enabled source. Manual scans report progress; scheduled ones only the result. */
    const scan = async (scheduled: boolean): Promise<Suggestion[]> => {
      if (running) throw new Error(running.scheduled ? 'A scheduled scan is running. Try again in a minute.' : 'Find roles is already running.')
      const ctrl = new AbortController()
      running = { ctrl, scheduled }
      const at = new Date().toISOString()
      pushStatus()
      try {
        const options = loadOptions(settings)
        const out = await runAutosearch({
          watchlist: loadWatchlist(settings),
          profile: ctx.services.profile.get(),
          tracks: ctx.services.profile.tracks(),
          dismissed: suggestions.recentDismissals(20),
          sources: options.sources,
          ai: ctx.services.ai,
          onBoard: (link) => !!ctx.services.roles.findByLink(link),
          settled: suggestions.settledKeys(),
          pending: suggestions.pendingKeys(),
          progress: (p) => {
            if (!scheduled) emit('search:progress', p)
          },
          signal: ctrl.signal,
          loadSimplify: (signal) => loadSimplifyListings(simplifyCache, { signal }),
        })
        recordReads(settings, out.reads)
        const saved = suggestions.merge(out.suggestions, out.reads)
        saveLastScan(settings, { at, ok: true, summary: out.summary, scheduled })
        emit('search:progress', { phase: 'done', message: out.summary, done: saved.length, total: saved.length })
        return saved
      } catch (err) {
        if (err instanceof CancelledError || ctrl.signal.aborted) {
          emit('search:progress', { phase: 'done', message: 'Find roles cancelled. Your earlier suggestions are unchanged.', done: 0, total: 0 })
          return suggestions.list()
        }
        const message = err instanceof Error ? err.message : String(err)
        saveLastScan(settings, { at, ok: false, summary: message, scheduled })
        if (!scheduled) emit('search:progress', { phase: 'error', message, done: 0, total: 0 })
        throw err
      } finally {
        running = null
        pushStatus()
      }
    }

    handle('search:watchlist', () => loadWatchlist(settings))
    handle('search:saveWatchlist', (list) => saveWatchlist(settings, list))
    handle('search:detectBoard', ({ url }) => detectBoard(url))
    handle('search:status', () => status())
    handle('search:setOptions', (patch) => {
      saveOptions(settings, patch ?? {})
      pushStatus()
      return status()
    })

    handle('search:run', () => scan(false))
    handle('search:cancel', () => {
      running?.ctrl.abort()
    })
    handle('search:suggestions', () => suggestions.list())

    handle('search:addSuggestion', ({ id }) => {
      const s = suggestions.get(id)
      if (!s) throw new Error('That suggestion is gone. Run Find roles again.')
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
          // Same label the tray showed, whether the AI or keywords ranked it.
          fit: fitFromScore(s.score),
          why: s.rankedBy === 'ai' ? s.reason : '',
          trackId: s.trackId && s.trackId !== DEFAULT_TRACK_ID ? s.trackId : '',
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

    const demo = process.env['TRACKER_DEMO'] === '1'
    if (demo) seedSearchDemo(settings, suggestions)
    // The daily scan is opt-in, and never runs in demo or headless (screenshot/test) sessions.
    if (!demo && !isHeadless()) {
      startScheduler({
        gate: () => ({ enabled: loadOptions(settings).scheduled, lastScanAt: loadLastScan(settings)?.at ?? null, running: !!running }),
        scan: () => scan(true),
      })
    }
  },
}
