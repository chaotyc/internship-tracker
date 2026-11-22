import { useEffect, useState, type ReactNode } from 'react'
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
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { Monogram } from '@renderer/features/board/RoleCard'
import { PaneHeader } from '@renderer/features/settings/PaneHeader'
import './search.css'

const key = boardKey
/** "d-Matrix" → "d Matrix" so the monogram reads DM, not D-. */
const monoName = (name: string) => name.replace(/[^\p{L}\p{N}\s]+/gu, ' ')
const GROUPS: SuggestedGroup[] = ['AI labs and platforms', 'AI chips', 'Semiconductors and hardware', 'Photonics and quantum']
const sourceOf = (c: Pick<WatchCompany, 'board'>): SuggestionSource => (c.board === 'workday' ? 'workday' : 'boards')

/** "just now", "12m ago", "3h ago", "yesterday", then a date. */
export function since(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((now - t) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** One board's last check, as a short muted line (or the error in danger text). */
function CheckLine({ st, off }: { st?: BoardStatus; off: boolean }) {
  if (off) return <span className="watch-check">Source turned off</span>
  if (!st) return <span className="watch-check">Not checked yet</span>
  if (st.error)
    return (
      <span className="watch-check error" title={st.error}>
        Failed {st.errorAt ? since(st.errorAt) : ''}: {st.error}
        {st.lastOk ? ` Last worked ${since(st.lastOk)}.` : ''}
      </span>
    )
  return <span className="watch-check">{st.lastOk ? `Checked ${since(st.lastOk)}` : 'Not checked yet'}</span>
}

function SourceSwitch({ checked, onChange, label, hint, children }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: ReactNode; children?: ReactNode }) {
  return (
    <li className="src-row">
      <label className="src-switch">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="src-switch-track" aria-hidden="true" />
        <span className="src-switch-text">
          {label}
          <small>{hint}</small>
          {children}
        </span>
      </label>
    </li>
  )
}

/** Companies whose public job boards autosearch scans. */
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
  const remaining = SUGGESTED_COMPANIES.filter((c) => !watched.has(key(c)))
  const addSuggested = (items: typeof SUGGESTED_COMPANIES) =>
    save([...(list ?? []), ...items.map(({ group: _g, ...c }) => ({ ...c, id: crypto.randomUUID() }))])

  return (
    <div className="watch">
      <PaneHeader title="Job boards" description="Companies whose public job boards autosearch scans for new roles." />
      <section className="settings-section">
        <h3>Add a company</h3>
        <p>Paste a careers page or job board link. Autosearch reads public Greenhouse, Ashby, Lever and Workday boards.</p>
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
              placeholder="jobs.ashbyhq.com/etched, a myworkdayjobs.com link or a careers page"
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

      {status && sources && (
        <section className="settings-section">
          <h3>Where to look</h3>
          <p>Autosearch reads the sources that are on when you click Find roles, and in the daily scan.</p>
          <ul className="src-list">
            <SourceSwitch checked={sources.boards} onChange={(v) => setSource('boards', v)} label="Job boards" hint="Greenhouse, Ashby and Lever boards on your list." />
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
              hint={
                <>
                  {SIMPLIFY_NOTE}{' '}
                  <a href={SIMPLIFY_REPO} target="_blank" rel="noreferrer">
                    {SIMPLIFY_REPO.replace(/^https:\/\//, '')}
                  </a>
                </>
              }
            >
              {sources.simplify && <CheckLine st={status.boards['simplify']} off={false} />}
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
                    ? `Last ${status.lastScan.scheduled ? 'scheduled ' : ''}scan ${since(status.lastScan.at)}${status.lastScan.ok ? '' : ' failed'}: ${status.lastScan.summary}`
                    : 'No scans yet.'}
              </span>
            </SourceSwitch>
          </ul>
        </section>
      )}

      <section className="settings-section">
        <div className="watch-head">
          <h3>Watching</h3>
          {list && list.length > 0 && <span className="chip tabular">{list.length}</span>}
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
                  {status && <CheckLine st={status.boards[key(c)]} off={!!sources && !sources[sourceOf(c)]} />}
                </span>
                <span className={`board-badge board-${c.board}`}>{BOARD_LABELS[c.board]}</span>
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
    </div>
  )
}
