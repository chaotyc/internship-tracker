import { useCallback, useEffect, useRef, useState } from 'react'
import { BOARD_LABELS, type Suggestion } from '@shared/search'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { ago } from '@renderer/lib/format'
import { Monogram } from '@renderer/features/board/RoleCard'
import { useEdgeFade } from './useEdgeFade'
import { setSuggestionState, useSuggestionState } from './useSuggestionState'
import './search.css'

const RANKED_BY: Record<NonNullable<Suggestion['rankedBy']>, string> = { ai: 'AI', keywords: 'keywords' }

/** "Greenhouse", "Workday" or "via SimplifyJobs list", plus the track it fits. */
export function sourceLine(s: Pick<Suggestion, 'source' | 'board' | 'trackName'>): string {
  const from = s.source === 'simplify' ? 'via SimplifyJobs list' : s.board ? BOARD_LABELS[s.board] : ''
  return [from, s.trackName && `${s.trackName} track`].filter(Boolean).join(' · ')
}

const SEASON = '(?:summer|fall|autumn|winter|spring)'
const TERM = `(?:${SEASON}\\s+(?:'?\\d{2}|\\d{4})|\\d{4}\\s+${SEASON})(?:\\s+(?:internships?|interns?|co-?ops?))?`
const TERM_SUFFIX = new RegExp(`\\s*(?:[-–—|:,]\\s*${TERM}|[(\\[]\\s*${TERM}\\s*[)\\]])\\s*$`, 'i')

/** Drops a trailing term like " – Summer 2027" or "(Summer 2027)" so titles fit one line; the full title stays in the tooltip. */
export function displayTitle(title: string): string {
  const short = title.replace(TERM_SUFFIX, '').trim()
  return short || title
}

/** Posted age first so freshness survives truncation, then location and pay: "2d ago · San Jose, CA · $50–60/hr". */
export function metaLine(s: Pick<Suggestion, 'postedAt' | 'location' | 'pay'>): string {
  return [s.postedAt && ago(s.postedAt), s.location, s.pay].filter(Boolean).join(' · ')
}

/** Same four-step scale as the board's fit meter. */
export function fitLevel(score: number): number {
  return score >= 85 ? 4 : score >= 70 ? 3 : score >= 50 ? 2 : 1
}

/** Estimated match, 0-100, drawn as the board's four-bar fit meter plus the number. */
function MatchMeter({ score, rankedBy }: { score: number; rankedBy?: Suggestion['rankedBy'] }) {
  const level = fitLevel(score)
  const pct = Math.round(Math.max(0, Math.min(100, score)))
  return (
    <span className="sugg-fit" title={rankedBy ? `Estimated match, ranked by ${RANKED_BY[rankedBy]}` : 'Estimated match'}>
      <span className="fit-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= level ? 'on' : ''} />
        ))}
      </span>
      <span className="sugg-fit-n tabular">{pct}% match</span>
    </span>
  )
}

/** Chevron drawn on the Icon grid; the shared set has no left/right chevrons. */
function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
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
  const { closeRequests } = useSuggestionState()
  const seenClose = useRef(closeRequests)

  // The top-bar pill asks to close through the shared store; App owns `open`, so close via onClose.
  useEffect(() => {
    if (closeRequests === seenClose.current) return
    seenClose.current = closeRequests
    if (open) onClose()
  }, [closeRequests, open, onClose])

  /** Scrolls the strip by about one card. */
  const page = (dir: 1 | -1) => {
    const el = scroller.current
    if (!el) return
    const card = el.querySelector<HTMLElement>('.sugg')
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0
    const step = card ? card.offsetWidth + gap : el.clientWidth * 0.8
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * step, behavior: reduce ? 'auto' : 'smooth' })
  }

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
        {items && items.length > 0 && <span className="tray-count tabular">{items.length}</span>}
        {ranking && (
          <span className="tray-ranked" title={ranking.title}>
            {ranking.text}
          </span>
        )}
        {keywordOnly && (
          <span className="tray-note">Connect an AI provider in Settings to rank against your resume.</span>
        )}
        {items && items.length > 0 && (fade.start || fade.end) && (
          <span className="tray-nav">
            <button type="button" className="icon-btn" onClick={() => page(-1)} disabled={!fade.start} aria-label="Previous suggestions" title="Previous">
              <Chevron dir="left" />
            </button>
            <button type="button" className="icon-btn" onClick={() => page(1)} disabled={!fade.end} aria-label="More suggestions" title="Next">
              <Chevron dir="right" />
            </button>
          </span>
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
            const meta = metaLine(s)
            const metaTitle = [s.postedAt && `Posted ${ago(s.postedAt)}`, s.location, s.pay].filter(Boolean).join(' · ')
            const from = sourceLine(s)
            return (
              <article key={s.id} className="sugg" aria-label={`${s.company}, ${s.title}`}>
                <div className="sugg-top">
                  <Monogram name={s.company} size={26} />
                  <div className="sugg-heading">
                    <div className="sugg-company" title={s.company}>
                      {s.company}
                    </div>
                    <a className="sugg-title" href={s.link} target="_blank" rel="noreferrer" title={`${s.title} — open posting`}>
                      {displayTitle(s.title)}
                    </a>
                  </div>
                </div>
                <div className="sugg-meta">
                  <MatchMeter score={s.score} rankedBy={s.rankedBy} />
                  {meta && (
                    <span className="sugg-meta-text" title={metaTitle}>
                      {meta}
                    </span>
                  )}
                </div>
                <p className="sugg-reason" title={s.reason}>
                  {s.reason}
                </p>
                <div className="sugg-source" title={from}>
                  {from || '\u00a0'}
                </div>
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
