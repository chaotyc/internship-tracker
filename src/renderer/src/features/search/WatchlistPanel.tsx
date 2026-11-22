import { useEffect, useState } from 'react'
import { BOARD_LABELS, SUGGESTED_COMPANIES, boardUrl, type SuggestedGroup, type WatchCompany } from '@shared/search'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { Monogram } from '@renderer/features/board/RoleCard'
import './search.css'

const key = (c: Pick<WatchCompany, 'board' | 'slug'>) => `${c.board}:${c.slug.toLowerCase()}`
/** "d-Matrix" → "d Matrix" so the monogram reads DM, not D-. */
const monoName = (name: string) => name.replace(/[^\p{L}\p{N}\s]+/gu, ' ')
const GROUPS: SuggestedGroup[] = ['AI labs and platforms', 'AI chips', 'Photonics and quantum']

/** Companies whose public job boards autosearch scans. */
export function WatchlistPanel() {
  const toast = useToast()
  const [list, setList] = useState<WatchCompany[] | null>(null)
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<{ text: string; tone: '' | 'error' }>({ text: '', tone: '' })

  useEffect(() => {
    api
      .invoke('search:watchlist')
      .then(setList)
      .catch((e: Error) => setNote({ text: `Couldn't load your job boards: ${e.message}`, tone: 'error' }))
  }, [])

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
        setNote({ text: "Couldn't find a Greenhouse, Ashby or Lever board there. Try the company's job board link itself.", tone: 'error' })
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
      <section className="settings-section">
        <h3>Add a company</h3>
        <p>Paste a careers page or job board link. Autosearch reads public Greenhouse, Ashby and Lever boards.</p>
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
              placeholder="jobs.ashbyhq.com/etched or a company careers page"
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
          <h3>Watching</h3>
          {list && list.length > 0 && <span className="chip tabular">{list.length}</span>}
        </div>
        {list == null ? null : list.length === 0 ? (
          <p className="watch-empty">No companies yet. Add one above, or pick from the suggestions below.</p>
        ) : (
          <ul className="watch-list">
            {list.map((c) => (
              <li key={c.id}>
                <Monogram name={monoName(c.name)} size={28} />
                <span className="watch-name">
                  <strong>{c.name}</strong>
                  <a href={boardUrl(c)} target="_blank" rel="noreferrer">
                    {boardUrl(c).replace(/^https:\/\//, '')}
                  </a>
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
          <p>Well-known AI, chip and photonics companies with public job boards. One click adds a company.</p>
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
