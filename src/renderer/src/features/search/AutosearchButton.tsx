import { useEffect, useRef, useState } from 'react'
import type { AutosearchProgress } from '@shared/search'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { loadSuggestionCount, requestTrayClose, useSuggestionState } from './useSuggestionState'
import './search.css'

const PHASE: Record<AutosearchProgress['phase'], string> = {
  fetching: 'Reading',
  filtering: 'Filtering',
  ranking: 'Ranking',
  done: 'Done',
  error: 'Stopped',
}

/** Scans the watched job boards and ranks new internships; opens the suggestions tray when it finds some. */
export function AutosearchButton({ onResults }: { onResults: () => void }) {
  const toast = useToast()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<AutosearchProgress | null>(null)
  const cancelled = useRef(false)
  const summary = useRef('')
  const { count, trayOpen } = useSuggestionState()

  useEffect(loadSuggestionCount, [])

  useEffect(
    () =>
      api.on('search:progress', (p) => {
        setProgress(p)
        if (p.phase === 'done') summary.current = p.message
      }),
    [],
  )

  const run = async () => {
    cancelled.current = false
    summary.current = ''
    setProgress({ phase: 'fetching', message: 'Starting…', done: 0, total: 0 })
    setRunning(true)
    try {
      const found = await api.invoke('search:run')
      if (cancelled.current) {
        toast('Autosearch cancelled.')
        return
      }
      const fresh = found.filter((s) => s.status === 'new')
      if (fresh.length) {
        onResults()
        toast(summary.current || `Found ${fresh.length} role${fresh.length === 1 ? '' : 's'} for you.`, { tone: 'success' })
      } else {
        toast(summary.current || 'No new roles matched your preferences this time.')
      }
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const cancel = () => {
    cancelled.current = true
    void api.invoke('search:cancel')
  }

  if (!running) {
    const waiting = count ?? 0
    const label = trayOpen ? 'Hide suggested roles' : `Show ${waiting} suggested role${waiting === 1 ? '' : 's'}`
    return (
      <div className="autosearch" role="group" aria-label="Find roles">
        <button type="button" className="btn autosearch-main" onClick={run} title="Find new internships on the job boards you follow">
          <Icon name="sparkle" />
          Find roles
        </button>
        <button
          type="button"
          className={`btn autosearch-sugg tabular${waiting > 0 ? ' has-items' : ''}${trayOpen ? ' is-pressed' : ''}`}
          onClick={trayOpen ? requestTrayClose : onResults}
          aria-pressed={trayOpen}
          aria-label={label}
          title={label}
        >
          {count ?? ''}
        </button>
      </div>
    )
  }

  const p = progress
  const pct = p && p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : null
  return (
    <div className="autosearch-run" role="status" aria-live="polite" title={p?.message}>
      <Icon name="sparkle" className="pulse" />
      <span className="autosearch-text">
        <span className="autosearch-phase">{p ? PHASE[p.phase] : 'Starting'}</span>
        {p && p.total > 0 && p.phase !== 'ranking' && (
          <span className="autosearch-count tabular">
            {p.done}/{p.total}
          </span>
        )}
      </span>
      <span className="autosearch-bar" aria-hidden="true">
        <span className={pct == null || p?.phase === 'ranking' ? 'is-indeterminate' : undefined} style={pct != null && p?.phase !== 'ranking' ? { width: `${pct}%` } : undefined} />
      </span>
      <button type="button" className="autosearch-cancel" onClick={cancel} aria-label="Cancel autosearch" title="Cancel">
        <Icon name="close" />
      </button>
    </div>
  )
}
