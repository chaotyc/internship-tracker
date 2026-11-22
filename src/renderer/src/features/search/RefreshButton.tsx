import { useRef, useState } from 'react'
import type { RefreshResult } from '@shared/search'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { daysUntil, shortDate } from '@renderer/lib/format'
import { Monogram } from '@renderer/features/board/RoleCard'
import { usePopover } from './usePopover'
import './search.css'

function dueText(deadline: string): string {
  const d = daysUntil(deadline)
  if (d == null) return 'Closing soon'
  if (d <= 0) return 'Due today'
  if (d === 1) return 'Due tomorrow'
  return `Due in ${d} days`
}

/** Checks Saved roles for closed and expiring postings, then shows what changed. */
export function RefreshButton() {
  const toast = useToast()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RefreshResult | null>(null)
  const [moved, setMoved] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  usePopover(open, wrap, () => setOpen(false))

  const run = async () => {
    if (running) return
    setRunning(true)
    setOpen(false)
    try {
      const r = await api.invoke('search:refresh')
      setResult(r)
      setMoved(new Set())
      setOpen(true)
    } catch (e) {
      toast(`Couldn't check postings: ${(e as Error).message}`, { tone: 'error' })
    } finally {
      setRunning(false)
    }
  }

  const moveToClosed = async (ids: string[]) => {
    try {
      for (const id of ids) await api.invoke('roles:update', { id, patch: { stage: 'closed' } })
      setMoved((s) => new Set([...s, ...ids]))
    } catch (e) {
      toast(`Couldn't move that role: ${(e as Error).message}`, { tone: 'error' })
    }
  }

  const pendingClosed = result?.closed.filter((c) => !moved.has(c.id)) ?? []
  const flagged = result ? result.closed.length + result.expiring.length : 0

  return (
    <div className="pop-wrap" ref={wrap}>
      <button
        type="button"
        className={`btn refresh-btn${open ? ' is-pressed' : ''}`}
        onClick={run}
        disabled={running}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={running}
        title={running ? 'Checking saved postings…' : 'Check saved postings for closures and deadlines'}
      >
        <Icon name="refresh" className={running ? 'spin' : undefined} />
        Check saved
      </button>
      {open && result && (
        <div className="popover refresh-pop" role="dialog" aria-label="Refresh results">
          <header className="pop-head">
            <div>
              <h3>Saved postings</h3>
              <p className="tabular">
                {result.checked} checked · {result.closed.length} closed · {result.expiring.length} closing soon
              </p>
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
              <Icon name="close" />
            </button>
          </header>

          {result.checked === 0 && !result.failed.length ? (
            <p className="pop-empty">No saved roles have a posting link to check. Add links to your Saved roles and try again.</p>
          ) : flagged === 0 && !result.failed.length ? (
            <p className="pop-empty ok">
              <Icon name="check" />
              Every saved posting is still open.
            </p>
          ) : (
            <div className="pop-body">
              {result.closed.length > 0 && (
                <section>
                  <div className="pop-section-head">
                    <h4>
                      <span className="dot danger" />
                      Closed
                    </h4>
                    {pendingClosed.length > 1 && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveToClosed(pendingClosed.map((c) => c.id))}>
                        Move all
                      </button>
                    )}
                  </div>
                  <ul className="pop-list">
                    {result.closed.map((c) => (
                      <li key={c.id}>
                        <Monogram name={c.company} size={24} />
                        <span className="pop-item-text">
                          <strong>{c.company}</strong>
                          <small>{c.title}</small>
                        </span>
                        {moved.has(c.id) ? (
                          <span className="chip ok">
                            <Icon name="check" />
                            Moved
                          </span>
                        ) : (
                          <button type="button" className="btn btn-sm" onClick={() => moveToClosed([c.id])}>
                            Move to Closed
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {result.expiring.length > 0 && (
                <section>
                  <div className="pop-section-head">
                    <h4>
                      <span className="dot warn" />
                      Closing soon
                    </h4>
                  </div>
                  <ul className="pop-list">
                    {result.expiring.map((c) => (
                      <li key={c.id}>
                        <Monogram name={c.company} size={24} />
                        <span className="pop-item-text">
                          <strong>{c.company}</strong>
                          <small>{c.title}</small>
                        </span>
                        <span className="chip warn" title={c.deadline ? `Deadline ${shortDate(c.deadline)}` : undefined}>
                          <Icon name="clock" />
                          {dueText(c.deadline)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {result.failed.length > 0 && (
                <section>
                  <div className="pop-section-head">
                    <h4>
                      <span className="dot" />
                      Couldn't check
                    </h4>
                  </div>
                  <ul className="pop-list">
                    {result.failed.map((c) => (
                      <li key={c.id}>
                        <Monogram name={c.company} size={24} />
                        <span className="pop-item-text">
                          <strong>{c.company}</strong>
                          <small title={c.detail}>{c.detail}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
          <footer className="pop-foot">
            <button type="button" className="btn btn-sm btn-ghost" onClick={run}>
              <Icon name="refresh" />
              Check again
            </button>
          </footer>
        </div>
      )}
    </div>
  )
}
