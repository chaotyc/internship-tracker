import { useCallback, useEffect, useRef, useState, type Ref } from 'react'
import { BOARD_LABELS, type Suggestion } from '@shared/search'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { ago } from '@renderer/lib/format'
import { FitMeter, Monogram } from '@renderer/features/board/RoleCard'
import { fitFromScore } from './labels'
import { useEdgeFade } from './useEdgeFade'
import { partCandidates, useFitText, wordCandidates } from './useFitText'
import { setSuggestionState, useSuggestionState } from './useSuggestionState'
import './search.css'

const RANKED_BY: Record<NonNullable<Suggestion['rankedBy']>, string> = { ai: 'AI', keywords: 'keywords' }

/** "<Source> · <Track> track", e.g. "SimplifyJobs · Photonics hardware track" or "Greenhouse · ML inference track". */
export function sourceLine(s: Pick<Suggestion, 'source' | 'board' | 'trackName'>): string {
  const from = s.source === 'simplify' ? 'SimplifyJobs' : s.board ? BOARD_LABELS[s.board] : ''
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

/** Posted age first so freshness survives, then location, then pay: ["2d ago", "San Jose, CA", "$50–60/hr"]. */
export function metaParts(s: Pick<Suggestion, 'postedAt' | 'location' | 'pay'>): string[] {
  return [s.postedAt && ago(s.postedAt), s.location, s.pay].filter((p): p is string => !!p)
}

/** The full meta line, "2d ago · San Jose, CA · $50–60/hr". */
export function metaLine(s: Pick<Suggestion, 'postedAt' | 'location' | 'pay'>): string {
  return metaParts(s).join(' · ')
}

/** The board card's fit meter with the label this role gets when added, then the score: "▮▮▮▮ Strong fit · 91%". */
function MatchMeter({ score, rankedBy }: { score: number; rankedBy?: Suggestion['rankedBy'] }) {
  const pct = Math.round(Math.max(0, Math.min(100, score)))
  return (
    <span className="sugg-fit tabular" title={rankedBy ? `Estimated by ${RANKED_BY[rankedBy]}` : 'Estimated'}>
      <FitMeter fit={fitFromScore(pct)} />
      <span className="sugg-fit-sep" aria-hidden="true">
        ·
      </span>
      {pct}%
    </span>
  )
}

/** Text that shows as much as fits without cutting a word or part; the full text stays in the tooltip. */
function FitText({ as: Tag = 'span', className, candidates, title }: { as?: 'span' | 'p' | 'div'; className: string; candidates: string[]; title?: string }) {
  const { ref, text } = useFitText<HTMLElement>(candidates)
  return (
    <Tag ref={ref as Ref<never>} className={className} title={title}>
      {text}
    </Tag>
  )
}

/** One suggestion card. */
function SuggestionCard({ s, busy, act }: { s: Suggestion; busy: boolean; act: (s: Suggestion, kind: 'add' | 'dismiss') => void }) {
  const meta = metaParts(s)
  const metaTitle = [s.postedAt && `Posted ${ago(s.postedAt)}`, s.location, s.pay].filter(Boolean).join(' · ')
  const from = sourceLine(s)
  const title = useFitText<HTMLAnchorElement>(wordCandidates(displayTitle(s.title)))
  return (
    <article className="sugg" aria-label={`${s.company}, ${s.title}`}>
      <div className="sugg-top">
        <Monogram name={s.company} size={26} />
        <div className="sugg-heading">
          <div className="sugg-company" title={s.company}>
            {s.company}
          </div>
          <a ref={title.ref} className="sugg-title" href={s.link} target="_blank" rel="noreferrer" title={`${s.title} — open posting`}>
            {title.text}
          </a>
        </div>
      </div>
      <div className="sugg-meta">
        <MatchMeter score={s.score} rankedBy={s.rankedBy} />
        {meta.length > 0 && <FitText className="sugg-meta-text" candidates={partCandidates(meta)} title={metaTitle} />}
      </div>
      <FitText as="p" className="sugg-reason" candidates={wordCandidates(s.reason)} title={s.reason} />
      {from ? <FitText as="div" className="sugg-source" candidates={wordCandidates(from)} title={from} /> : <div className="sugg-source">{'\u00a0'}</div>}
      <div className="sugg-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act(s, 'add')}>
          <Icon name="plus" />
          Add to Saved
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act(s, 'dismiss')}>
          Dismiss
        </button>
        <a className="icon-btn sugg-open" href={s.link} target="_blank" rel="noreferrer" aria-label="Open posting" title="Open posting">
          <Icon name="external" />
        </a>
      </div>
    </article>
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

/** Roles Find roles turned up, ready to add to Saved or dismiss. */
export function SuggestionsTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const scroller = useRef<HTMLDivElement>(null)
  const fade = useEdgeFade(scroller, [items, open, error])
  const { closeRequests } = useSuggestionState()
  const seenClose = useRef(closeRequests)

  // The top-bar count button asks to close through the shared store; App owns `open`, so close via onClose.
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
          {items.map((s) => (
            <SuggestionCard key={s.id} s={s} busy={busy.has(s.id)} act={act} />
          ))}
        </div>
      )}
    </section>
  )
}
