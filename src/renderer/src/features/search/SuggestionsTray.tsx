import { useCallback, useEffect, useRef, useState } from 'react'
import { BOARD_LABELS, type Suggestion } from '@shared/search'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { ago } from '@renderer/lib/format'
import { Monogram } from '@renderer/features/board/RoleCard'
import { useEdgeFade } from './useEdgeFade'
import { setSuggestionState } from './useSuggestionState'
import './search.css'

const RANKED_BY: Record<NonNullable<Suggestion['rankedBy']>, string> = { ai: 'by AI', keywords: 'by keyword match' }

/** Estimated match, 0-100. One neutral scale: the bar length carries the value, not a hue. */
function Meter({ score, rankedBy }: { score: number; rankedBy?: Suggestion['rankedBy'] }) {
  const how = rankedBy ? `, estimated ${RANKED_BY[rankedBy]}` : ''
  return (
    <span className="meter" title={`Estimated match: ${score} out of 100${how}`}>
      <span className="meter-track" aria-hidden="true">
        <span style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
      </span>
      <span className="meter-n tabular" aria-hidden="true">
        {score} <span className="meter-l">match</span>
      </span>
      <span className="visually-hidden">Estimated match {score} out of 100</span>
    </span>
  )
}

/** Header label for how this batch was ranked. */
function rankingLabel(items: Suggestion[]): { text: string; title: string } | null {
  const kinds = new Set(items.map((s) => s.rankedBy).filter(Boolean))
  if (!kinds.size) return null
  if (kinds.size > 1) return { text: 'Ranked by AI and keywords', title: 'Some roles were ranked by the connected AI, others by keyword match.' }
  return kinds.has('ai')
    ? { text: 'Ranked by AI', title: 'Match estimates come from the connected AI, comparing each posting with your resume and preferences.' }
    : { text: 'Ranked by keywords', title: 'Match estimates come from keyword overlap with your preferences.' }
}

/** Roles autosearch found, ready to add to Saved or dismiss. */
export function SuggestionsTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const scroller = useRef<HTMLDivElement>(null)
  const fade = useEdgeFade(scroller, [items, open, error])

  const load = useCallback(() => {
    api
      .invoke('search:suggestions')
      .then((s) => {
        setItems(s)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])
  useEffect(() => api.on('search:progress', (p) => p.phase === 'done' && load()), [load])
  useEffect(() => {
    if (items) setSuggestionState({ count: items.length })
  }, [items])
  useEffect(() => {
    setSuggestionState({ trayOpen: open })
    return () => setSuggestionState({ trayOpen: false })
  }, [open])

  const act = async (s: Suggestion, kind: 'add' | 'dismiss') => {
    setBusy((b) => new Set(b).add(s.id))
    try {
      if (kind === 'add') {
        await api.invoke('search:addSuggestion', { id: s.id })
        toast(`Added ${s.company} to Saved.`, { tone: 'success' })
      } else {
        await api.invoke('search:dismissSuggestion', { id: s.id })
      }
      setItems((cur) => cur?.filter((x) => x.id !== s.id) ?? cur)
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    } finally {
      setBusy((b) => {
        const n = new Set(b)
        n.delete(s.id)
        return n
      })
    }
  }

  if (!open) return null
  const keywordOnly = !!items?.length && items.every((s) => s.rankedBy === 'keywords')
  const ranking = items?.length ? rankingLabel(items) : null

  return (
    <section className="tray" aria-label="Suggested roles">
      <header className="tray-head">
        <span className="tray-icon" aria-hidden="true">
          <Icon name="sparkle" />
        </span>
        <h2>Suggested for you</h2>
        {items && items.length > 0 && <span className="chip tabular">{items.length}</span>}
        {ranking && (
          <span className="tray-ranked" title={ranking.title}>
            {ranking.text}
          </span>
        )}
        {keywordOnly && (
          <span className="tray-note">Connect an AI provider in Settings to rank against your resume.</span>
        )}
        <button type="button" className="icon-btn tray-close" onClick={onClose} aria-label="Close suggestions" title="Close">
          <Icon name="close" />
        </button>
      </header>

      {error ? (
        <div className="tray-state">
          <Icon name="alert" />
          <span>Couldn't load suggestions: {error}</span>
          <button type="button" className="btn btn-sm" onClick={load}>
            Try again
          </button>
        </div>
      ) : items == null ? (
        <div className="tray-scroll" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="sugg is-skeleton" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="tray-state">
          <Icon name="check" />
          <span>Nothing waiting for you. Use Find roles to check the job boards you follow for new internships.</span>
        </div>
      ) : (
        <div
          ref={scroller}
          className={`tray-scroll${fade.start ? ' fade-start' : ''}${fade.end ? ' fade-end' : ''}`}
        >
          {items.map((s) => {
            const meta = [s.location, s.postedAt && `Posted ${ago(s.postedAt)}`, s.pay, s.board && BOARD_LABELS[s.board]]
              .filter(Boolean)
              .join(' · ')
            return (
              <article key={s.id} className="sugg" aria-label={`${s.company}, ${s.title}`}>
                <div className="sugg-top">
                  <Monogram name={s.company} size={26} />
                  <div className="sugg-heading">
                    <div className="sugg-company">
                      <span className="sugg-company-name">{s.company}</span>
                      <Meter score={s.score} rankedBy={s.rankedBy} />
                    </div>
                    <a className="sugg-title" href={s.link} target="_blank" rel="noreferrer" title={`${s.title} — open posting`}>
                      {s.title}
                    </a>
                  </div>
                </div>
                {meta && (
                  <div className="sugg-meta" title={meta}>
                    {meta}
                  </div>
                )}
                <p className="sugg-reason" title={s.reason}>
                  {s.reason}
                </p>
                <div className="sugg-actions">
                  <button type="button" className="btn btn-sm" disabled={busy.has(s.id)} onClick={() => act(s, 'add')}>
                    <Icon name="plus" />
                    Add to Saved
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy.has(s.id)} onClick={() => act(s, 'dismiss')}>
                    Dismiss
                  </button>
                  <a className="icon-btn sugg-open" href={s.link} target="_blank" rel="noreferrer" aria-label="Open posting" title="Open posting">
                    <Icon name="external" />
                  </a>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
