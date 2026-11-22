import { useCallback, useEffect, useState } from 'react'
import { BOARD_LABELS, type Suggestion } from '@shared/search'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { ago } from '@renderer/lib/format'
import { Monogram } from '@renderer/features/board/RoleCard'
import './search.css'

function tone(score: number): 'high' | 'mid' | 'low' {
  return score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low'
}

function Meter({ score }: { score: number }) {
  return (
    <span className={`meter meter-${tone(score)}`} title={`${score} out of 100 match`}>
      <span className="meter-track" aria-hidden="true">
        <span style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
      </span>
      <span className="meter-n tabular">{score}</span>
      <span className="visually-hidden">out of 100 match</span>
    </span>
  )
}

/** Roles autosearch found, ready to add to Saved or dismiss. */
export function SuggestionsTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())

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

  return (
    <section className="tray" aria-label="Suggested roles">
      <header className="tray-head">
        <span className="tray-icon" aria-hidden="true">
          <Icon name="sparkle" />
        </span>
        <h2>Suggested for you</h2>
        {items && items.length > 0 && <span className="chip tabular">{items.length}</span>}
        {keywordOnly && (
          <span className="tray-note">Ranked by keyword match. Connect an AI provider in Settings for ranking against your resume.</span>
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
          <span>Nothing waiting for you. Run Autosearch to check the job boards you follow for new internships.</span>
        </div>
      ) : (
        <div className="tray-scroll">
          {items.map((s) => {
            const meta = [s.location, s.postedAt && `Posted ${ago(s.postedAt)}`].filter(Boolean).join(' · ')
            return (
              <article key={s.id} className="sugg" aria-label={`${s.company}, ${s.title}`}>
                <div className="sugg-top">
                  <Monogram name={s.company} size={30} />
                  <div className="sugg-heading">
                    <div className="sugg-company">
                      <span className="sugg-company-name">{s.company}</span>
                      {s.board && <span className="sugg-board">{BOARD_LABELS[s.board]}</span>}
                      <Meter score={s.score} />
                    </div>
                    <a className="sugg-title" href={s.link} target="_blank" rel="noreferrer" title={`${s.title} — open posting`}>
                      {s.title}
                    </a>
                  </div>
                </div>
                {(meta || s.pay) && (
                  <div className="sugg-meta">
                    {meta}
                    {s.pay && <span className="sugg-pay">{s.pay}</span>}
                  </div>
                )}
                <p className="sugg-reason">{s.reason}</p>
                <div className="sugg-actions">
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy.has(s.id)} onClick={() => act(s, 'add')}>
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
