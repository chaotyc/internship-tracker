import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { SKIP_REASONS, type ScanReport, type SkipReason } from '@shared/search'
import { Dialog } from '@renderer/components/Dialog'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { since } from '@renderer/lib/format'
import { Monogram } from '@renderer/features/board/RoleCard'
import './search.css'

// Open state shared by every "View skipped" entry point (tray, toast, Settings → Job boards).
let open = false
const subs = new Set<() => void>()
const notify = () => subs.forEach((fn) => fn())
export function openSkipped(): void {
  open = true
  notify()
}
function closeSkipped(): void {
  open = false
  notify()
}
const subscribe = (fn: () => void) => {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

/**
 * How many near misses the last Find roles run skipped, for the "N skipped" buttons. Other role types
 * (senior roles on an internship search, say) aren't counted; they'd drown out the ones worth a look.
 */
export function skippedTotal(r: ScanReport | null): number {
  return r ? SKIP_REASONS.reduce((n, x) => n + (x.key === 'type' ? 0 : (r.counts[x.key] ?? 0)), 0) : 0
}

/** Every posting the last Find roles run left out, grouped by why, with a way to add any of them. */
export function SkippedDialog() {
  const isOpen = useSyncExternalStore(subscribe, () => open)
  const toast = useToast()
  const [report, setReport] = useState<ScanReport | null | undefined>(undefined)
  const [tab, setTab] = useState<SkipReason | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const idBase = useId()
  const tabRefs = useRef(new Map<SkipReason, HTMLButtonElement>())
  const tabId = (k: SkipReason) => `${idBase}-tab-${k}`
  const panelId = `${idBase}-panel`

  useEffect(() => {
    if (!isOpen) return
    setReport(undefined)
    setAdded(new Set())
    api
      .invoke('search:report')
      .then((r) => {
        setReport(r)
        setTab(SKIP_REASONS.find((x) => r?.counts[x.key])?.key ?? null)
      })
      .catch(() => setReport(null))
  }, [isOpen])

  const tabs = useMemo(() => SKIP_REASONS.filter((x) => report?.counts[x.key]), [report])
  const rows = useMemo(() => (report && tab ? report.skipped.filter((s) => s.reason === tab) : []), [report, tab])
  const hidden = report && tab ? Math.max(0, report.counts[tab] - rows.length) : 0

  /** Arrow keys, Home and End move between tabs and select them, as in any tab list. */
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((x) => x.key === tab)
    if (i < 0 || !tabs.length) return
    const next =
      e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1
    if (next < 0) return
    e.preventDefault()
    const k = tabs[next]!.key
    setTab(k)
    tabRefs.current.get(k)?.focus()
  }

  const add = async (link: string, company: string) => {
    setBusy(link)
    try {
      await api.invoke('search:addSkipped', { link })
      setAdded((a) => new Set(a).add(link))
      toast(`Added ${company} to Saved.`, { tone: 'success' })
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const subtitle = report
    ? `Last run ${since(report.at)}: checked ${report.total} posting${report.total === 1 ? '' : 's'}, suggested ${report.matched}${report.alreadySeen ? `, ${report.alreadySeen} already seen` : ''}.`
    : undefined

  return (
    <Dialog open={isOpen} onClose={closeSkipped} title="Skipped postings" subtitle={subtitle} width={760} className="skipped-dialog">
      {report === undefined ? (
        <p className="skipped-empty" role="status">
          Loading…
        </p>
      ) : !report || !tabs.length ? (
        <p className="skipped-empty">{report ? 'Nothing was skipped in the last run.' : 'Run Find roles first. Postings it leaves out will be listed here, with the reason.'}</p>
      ) : (
        <>
          <div className="skipped-tabs" role="tablist" aria-label="Why postings were skipped" onKeyDown={onTabKey}>
            {tabs.map((x) => (
              <button
                key={x.key}
                ref={(el) => {
                  if (el) tabRefs.current.set(x.key, el)
                  else tabRefs.current.delete(x.key)
                }}
                id={tabId(x.key)}
                type="button"
                role="tab"
                aria-selected={tab === x.key}
                aria-controls={panelId}
                tabIndex={tab === x.key ? 0 : -1}
                aria-label={`${x.label}, ${report.counts[x.key]}`}
                className={`skipped-tab${tab === x.key ? ' is-on' : ''}`}
                onClick={() => setTab(x.key)}
              >
                {x.label}
                <span className="tabular">{report.counts[x.key]}</span>
              </button>
            ))}
          </div>
          <div id={panelId} role="tabpanel" aria-labelledby={tab ? tabId(tab) : undefined} className="skipped-panel">
            <ul className="skipped-list">
              {rows.map((s) => {
                const done = added.has(s.link)
                return (
                  <li key={s.link} className="skipped-row">
                    <Monogram name={s.company} size={26} />
                    <div className="skipped-main">
                      <div className="skipped-title" title={`${s.company} · ${s.title}`}>
                        <strong>{s.company}</strong> · {s.title}
                      </div>
                      <div className="skipped-meta" title={s.detail}>
                        {[s.location, s.detail].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="skipped-actions">
                      <a className="icon-btn" href={s.link} target="_blank" rel="noreferrer" aria-label={`Open ${s.company}, ${s.title}`} title="Open posting">
                        <Icon name="external" />
                      </a>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={done || busy === s.link}
                        onClick={() => void add(s.link, s.company)}
                        aria-label={done ? `${s.company}, ${s.title}: added to Saved` : `Add ${s.company}, ${s.title} to Saved`}
                      >
                        {done ? (
                          <>
                            <Icon name="check" />
                            Added
                          </>
                        ) : (
                          <>
                            <Icon name="plus" />
                            Add to Saved
                          </>
                        )}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {hidden > 0 && <p className="skipped-more">And {hidden} more not listed.</p>}
          </div>
        </>
      )}
    </Dialog>
  )
}
