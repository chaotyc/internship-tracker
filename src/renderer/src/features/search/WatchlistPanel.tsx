import { useEffect, useId, useState, type ReactNode } from 'react'
import {
  BOARD_LABELS,
  SIMPLIFY_NOTE,
  SIMPLIFY_REPO,
  SUGGESTED_COMPANIES,
  boardKey,
  boardUrl,
  type BoardStatus,
  type SearchOptions,
  type SearchStatus,
  type SuggestedGroup,
  type SuggestionSource,
  type WatchCompany,
} from '@shared/search'
import { Icon } from '@renderer/components/Icon'
import { Switch } from '@renderer/components/Switch'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { since } from '@renderer/lib/format'
import { Monogram } from '@renderer/features/board/RoleCard'
import { PaneHeader } from '@renderer/features/settings/PaneHeader'
import { boardFailure } from './labels'
import './search.css'

const key = boardKey
/** "d-Matrix" → "d Matrix" so the monogram reads DM, not D-. */
const monoName = (name: string) => name.replace(/[^\p{L}\p{N}\s]+/gu, ' ')
const GROUPS: SuggestedGroup[] = ['AI labs and platforms', 'AI chips', 'Semiconductors and hardware', 'Photonics and quantum']
const sourceOf = (c: Pick<WatchCompany, 'board'>): SuggestionSource => (c.board === 'workday' ? 'workday' : 'boards')

/** "just now", "12m ago", "3h ago", "yesterday", then a date. */
// The one relative-time rule lives in lib/format.
export { since }

/** A board counts as stale when its last good check is older than this. */
const STALE_MS = 2 * 24 * 60 * 60 * 1000

/** Whether a board's last check worked and is recent; those rows don't repeat the time the header already gives. */
export function isFresh(st: BoardStatus | undefined, now = Date.now()): st is BoardStatus & { lastOk: string } {
  if (!st || st.error || !st.lastOk) return false
  const t = Date.parse(st.lastOk)
  return Number.isFinite(t) && now - t <= STALE_MS
}

/** When a board was last checked, whether or not that check worked. */
/**
 * "all checked 3h ago", "7 checked 3h ago · 1 failed" or "not checked yet", for the boards whose
 * source is on. A failed attempt does not count as checked. Failed and stale boards also say so on their rows.
 */
export function watchSummary(statuses: Array<BoardStatus | undefined>, now = Date.now()): string {
  if (!statuses.length) return ''
  const failed = statuses.filter((st) => !!st?.error).length
  const okTimes = statuses
    .filter((st) => !st?.error)
    .map((st) => (st?.lastOk ? Date.parse(st.lastOk) : NaN))
    .filter(Number.isFinite)
  const failNote = failed ? ` · ${failed} failed` : ''
  if (!okTimes.length) return failed ? `${failed} failed` : 'not checked yet'
  // Stale boards say so on their own rows, so the shared time covers only recent checks.
  const recent = okTimes.filter((t) => now - t <= STALE_MS)
  if (!recent.length) return failNote.slice(3)
  const all = recent.length === statuses.length
  return `${all ? 'all' : recent.length} checked ${since(new Date(Math.min(...recent)).toISOString(), now)}${failNote}`
}

/**
 * One board's last check. With `always`, says when it last worked; otherwise only speaks up when the
 * board failed or is stale, since the list header already gives the shared check time.
 */
function CheckLine({ st, board, off, always = false }: { st?: BoardStatus; board: string; off: boolean; always?: boolean }) {
  if (off) return <span className="watch-check">Source turned off</span>
  if (st?.error) {
    const fail = boardFailure(board, st.error)
    const text = fail.tone === 'warn' ? `${fail.text} · will retry next run` : fail.text
    const detail = [st.errorAt && `Failed ${since(st.errorAt)}`, st.lastOk && `last worked ${since(st.lastOk)}`, st.error].filter(Boolean).join(' · ')
    return (
      <span className={`watch-check ${fail.tone}`} title={detail}>
        {text}
      </span>
    )
  }
  if (isFresh(st)) return always ? <span className="watch-check">Checked {since(st.lastOk)}</span> : null
  if (st?.lastOk) return <span className="watch-check stale">Last checked {since(st.lastOk)}</span>
  return always ? <span className="watch-check">Not checked yet</span> : null
}

/** A switch row. `children` sit under the hint, outside the label, so links and buttons there don't flip the switch. */
function SourceSwitch({ checked, onChange, label, hint, children }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: ReactNode; children?: ReactNode }) {
  return (
    <li className="src-row">
      <Switch checked={checked} onChange={onChange} label={label} hint={hint} />
      {children && <div className="src-extra">{children}</div>}
    </li>
  )
}

/** First sentence of the SimplifyJobs note up front; the licensing detail behind a disclosure. */
const [SIMPLIFY_LEAD, ...simplifyRest] = SIMPLIFY_NOTE.split(/(?<=\.)\s+/)
const SIMPLIFY_DETAIL = simplifyRest.join(' ')

function SimplifyDetails() {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <button type="button" className="settings-disclosure" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Icon name="chevronDown" />
        License and privacy
      </button>
      {open && (
        <p id={id} className="src-detail">
          {SIMPLIFY_DETAIL}{' '}
          <a href={SIMPLIFY_REPO} target="_blank" rel="noreferrer">
            {SIMPLIFY_REPO.replace(/^https:\/\//, '')}
          </a>
        </p>
      )}
    </>
  )
}

/** Companies whose public job boards Find roles scans. */
export function WatchlistPanel() {
  const toast = useToast()
  const [list, setList] = useState<WatchCompany[] | null>(null)
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<{ text: string; tone: '' | 'error' }>({ text: '', tone: '' })
  const [status, setStatus] = useState<SearchStatus | null>(null)

  useEffect(() => {
    api
      .invoke('search:watchlist')
      .then(setList)
      .catch((e: Error) => setNote({ text: `Couldn't load your job boards: ${e.message}`, tone: 'error' }))
    api
      .invoke('search:status')
      .then(setStatus)
      .catch(() => {})
    return api.on('search:statusChanged', setStatus)
  }, [])

  const setOptions = async (patch: Partial<SearchOptions>) => {
    const prev = status
    if (status) setStatus({ ...status, options: { ...status.options, ...patch, sources: { ...status.options.sources, ...patch.sources } } })
    try {
      setStatus(await api.invoke('search:setOptions', patch))
    } catch (e) {
      setStatus(prev)
      toast(`Couldn't save: ${(e as Error).message}`, { tone: 'error' })
    }
  }
  const sources = status?.options.sources
  const setSource = (src: SuggestionSource, on: boolean) => sources && setOptions({ sources: { ...sources, [src]: on } })

  const save = async (next: WatchCompany[]) => {
    const prev = list
    setList(next)
    try {
      setList(await api.invoke('search:saveWatchlist', next))
    } catch (e) {
      setList(prev)
      toast(`Couldn't save: ${(e as Error).message}`, { tone: 'error' })
    }
  }

  const add = async () => {
    const value = url.trim()
    if (!value) return
    setAdding(true)
    setNote({ text: 'Looking for a job board…', tone: '' })
    try {
      const found = await api.invoke('search:detectBoard', { url: value })
      if (!found) {
        setNote({ text: "Couldn't find a Greenhouse, Ashby, Lever or Workday board there. Try the company's job board link itself.", tone: 'error' })
        return
      }
      if (list?.some((c) => key(c) === key(found))) {
        setNote({ text: `${found.name} is already on your list.`, tone: '' })
        return
      }
      await save([...(list ?? []), found])
      setUrl('')
      setNote({ text: `Added ${found.name} (${BOARD_LABELS[found.board]}).`, tone: '' })
    } catch (e) {
      setNote({ text: (e as Error).message, tone: 'error' })
    } finally {
      setAdding(false)
    }
  }

  const watched = new Set((list ?? []).map(key))
  const summary =
    status && list?.length ? watchSummary(list.filter((c) => !sources || sources[sourceOf(c)]).map((c) => status.boards[key(c)])) : ''
  const remaining = SUGGESTED_COMPANIES.filter((c) => !watched.has(key(c)))
  const addSuggested = (items: typeof SUGGESTED_COMPANIES) =>
    save([...(list ?? []), ...items.map(({ group: _g, ...c }) => ({ ...c, id: crypto.randomUUID() }))])

  return (
    <div className="watch">
      <PaneHeader title="Job boards" description="Companies Find roles checks for new postings." />
      <section className="settings-section">
        <h3>Add a company</h3>
        <p>Paste a careers page or job board link. Find roles reads public Greenhouse, Ashby, Lever and Workday boards.</p>
        <form
          className="watch-add"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <label className="link-input watch-input">
            <Icon name="link" />
            <input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (note.tone === 'error') setNote({ text: '', tone: '' })
              }}
              placeholder="Careers page or job board link"
              aria-label="Careers page or job board link"
              spellCheck={false}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={adding || !url.trim()}>
            {adding ? <Icon name="refresh" className="spin" /> : <Icon name="plus" />}
            {adding ? 'Checking…' : 'Add'}
          </button>
        </form>
        {note.text && <p className={`watch-note${note.tone ? ` ${note.tone}` : ''}`}>{note.text}</p>}
      </section>

      <section className="settings-section">
        <div className="watch-head">
          <h3>
            Watching
            {list && list.length > 0 && <span className="watch-count tabular">{list.length}</span>}
          </h3>
          {summary && (
            <span className="watch-summary">
              {summary.split(/( · \d+ failed)/).map((part, i) =>
                / failed$/.test(part) ? (
                  <span key={i} className="watch-summary-failed">
                    {part}
                  </span>
                ) : (
                  part
                ),
              )}
            </span>
          )}
        </div>
        {list == null ? null : list.length === 0 ? (
          <p className="watch-empty">No companies yet. Add one above, or pick from the suggestions below.</p>
        ) : (
          <ul className="watch-list">
            {list.map((c) => (
              <li key={c.id} className={sources && !sources[sourceOf(c)] ? 'is-off' : undefined}>
                <Monogram name={monoName(c.name)} size={28} />
                <span className="watch-name">
                  <strong>{c.name}</strong>
                  <a href={boardUrl(c)} target="_blank" rel="noreferrer">
                    {boardUrl(c).replace(/^https:\/\//, '')}
                  </a>
                  {status && <CheckLine st={status.boards[key(c)]} board={BOARD_LABELS[c.board]} off={!!sources && !sources[sourceOf(c)]} />}
                </span>
                <span className="board-badge">{BOARD_LABELS[c.board]}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => save(list.filter((x) => x.id !== c.id))}
                  aria-label={`Stop watching ${c.name}`}
                  title="Remove"
                >
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {remaining.length > 0 && (
        <section className="settings-section">
          <div className="watch-head">
            <h3>Suggested companies</h3>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => addSuggested(remaining)}>
              Add all {remaining.length}
            </button>
          </div>
          <p>Well-known AI, chip, semiconductor and photonics companies with public job boards. One click adds a company.</p>
          {GROUPS.map((g) => {
            const items = remaining.filter((c) => c.group === g)
            if (!items.length) return null
            return (
              <div key={g} className="watch-group">
                <h4>{g}</h4>
                <div className="watch-suggest">
                  {items.map((c) => (
                    <button key={key(c)} type="button" className="watch-pill" onClick={() => addSuggested([c])} title={`Add ${c.name} (${BOARD_LABELS[c.board]})`}>
                      <Monogram name={monoName(c.name)} size={20} />
                      {c.name}
                      <Icon name="plus" className="watch-pill-plus" />
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {status && sources && (
        <section className="settings-section">
          <h3>Where to look</h3>
          <p>Find roles reads the sources that are on, both when you click it and in the daily scan.</p>
          <ul className="src-list">
            <SourceSwitch checked={sources.boards} onChange={(v) => setSource('boards', v)} label="Greenhouse, Ashby & Lever" hint="The Greenhouse, Ashby and Lever boards on your list." />
            <SourceSwitch
              checked={sources.workday}
              onChange={(v) => setSource('workday', v)}
              label="Workday"
              hint="Workday careers sites on your list, searched for “intern” and your target roles. Two requests at a time per site."
            />
            <SourceSwitch
              checked={sources.simplify}
              onChange={(v) => setSource('simplify', v)}
              label="SimplifyJobs list"
              hint={SIMPLIFY_LEAD}
            >
              <SimplifyDetails />
              {sources.simplify && <CheckLine st={status.boards['simplify']} board="SimplifyJobs" off={false} always />}
            </SourceSwitch>
          </ul>
        </section>
      )}

      {status && (
        <section className="settings-section">
          <h3>Daily scan</h3>
          <ul className="src-list">
            <SourceSwitch
              checked={status.options.scheduled}
              onChange={(v) => setOptions({ scheduled: v })}
              label="Check for new roles once a day"
              hint="While the app is open, at most once a day, plus a catch-up when you open it after a day or more. New roles are added to your suggestions; the AI is only asked when something new turns up."
            >
              <span className={`watch-check${status.lastScan && !status.lastScan.ok ? ' error' : ''}`}>
                {status.running
                  ? 'Scanning now…'
                  : status.lastScan
                    ? `Last scan ${status.lastScan.ok ? '' : 'failed '}${since(status.lastScan.at)}${status.lastScan.scheduled ? '' : ' (manual)'}: ${status.lastScan.summary}`
                    : 'No scans yet.'}
              </span>
            </SourceSwitch>
          </ul>
        </section>
      )}
    </div>
  )
}
