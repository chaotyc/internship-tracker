import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { Role } from '@shared/roles'
import {
  completeStep,
  groupToday,
  localIso,
  snoozeDate,
  snoozeStep,
  type EmailProposal,
  type SnoozeKey,
  type TodayItem,
  type TodaySectionKey,
} from '@shared/today'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api, useRoles } from '@renderer/lib/api'
import { dueLabel, shortDate } from '@renderer/lib/format'
import { Monogram } from '@renderer/features/board/RoleCard'
import { EmailDrop } from './EmailDrop'
import { ProposalCard } from './ProposalCard'
import { MailIcon, readEmailFile, stageLabel, stageStyle } from './parts'
import './today.css'

const keyOf = (i: TodayItem) => `${i.roleId}:${i.kind}`

const openSettings = (tab: string) => window.dispatchEvent(new CustomEvent('app:open-settings', { detail: tab }))

/** Overdue, today, this week, later and undated next steps and deadlines, with email updates on top. */
export function TodayView({ onOpenRole }: { onOpenRole: (id: string) => void }) {
  const toast = useToast()
  const { roles } = useRoles()
  const [items, setItems] = useState<TodayItem[] | null>(null)
  const [proposals, setProposals] = useState<EmailProposal[]>([])
  const [error, setError] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [incoming, setIncoming] = useState<{ raw: string; n: number } | null>(null)
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const [today, setToday] = useState(localIso())
  const listRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)

  const load = useCallback(() => {
    setToday(localIso())
    api
      .invoke('today:list')
      .then((r) => {
        setItems(r)
        setLeaving(new Set())
        setError('')
      })
      .catch((e: Error) => setError(e.message))
    api
      .invoke('today:proposals')
      .then(setProposals)
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const offRoles = api.on('roles:changed', load)
    const offToday = api.on('today:changed', load)
    // Roll over at midnight and when the window comes back.
    const onFocus = () => localIso() !== today && load()
    window.addEventListener('focus', onFocus)
    const tick = setInterval(onFocus, 60_000)
    return () => {
      offRoles()
      offToday()
      window.removeEventListener('focus', onFocus)
      clearInterval(tick)
    }
  }, [load, today])

  const byId = useMemo(() => new Map((roles ?? []).map((r) => [r.id, r])), [roles])
  const visible = useMemo(() => (items ?? []).filter((i) => !leaving.has(keyOf(i))), [items, leaving])
  const sections = useMemo(() => groupToday(visible, today), [visible, today])
  const count = (k: TodaySectionKey) => sections.find((s) => s.key === k)?.items.length ?? 0

  /* ---------------------------------- actions ---------------------------------- */

  const patchStep = async (item: TodayItem, next: (r: Role) => Role['nextStep'], message: string) => {
    const role = byId.get(item.roleId)
    if (!role?.nextStep) return
    const before = role.nextStep
    setLeaving((s) => new Set(s).add(keyOf(item)))
    try {
      await api.invoke('roles:update', { id: role.id, patch: { nextStep: next(role) } })
      toast(message, {
        action: {
          label: 'Undo',
          run: () => void api.invoke('roles:update', { id: role.id, patch: { nextStep: before } }).catch((e: Error) => toast(e.message, { tone: 'error' })),
        },
      })
    } catch (e) {
      setLeaving((s) => {
        const n = new Set(s)
        n.delete(keyOf(item))
        return n
      })
      toast(`Couldn't update ${role.company}: ${(e as Error).message}`, { tone: 'error' })
    }
  }

  const done = (item: TodayItem) => void patchStep(item, (r) => completeStep(r.nextStep!), `Done: ${item.text}`)
  const snooze = (item: TodayItem, when: SnoozeKey) => {
    const date = snoozeDate(when, today)
    void patchStep(item, (r) => snoozeStep(r.nextStep!, when, today), `Snoozed to ${dueLabel(date, item.time)}.`)
  }

  /* --------------------------------- keyboard --------------------------------- */

  const focusRow = (from: HTMLElement, delta: number) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])
    const i = rows.indexOf(from)
    rows[Math.max(0, Math.min(rows.length - 1, i + delta))]?.focus()
  }
  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, item: TodayItem) => {
    const row = e.currentTarget
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      focusRow(row, 1)
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      focusRow(row, -1)
      return
    }
    if (e.target !== row || e.metaKey || e.ctrlKey || e.altKey) return
    const step = item.kind === 'next-step'
    const act = (fn: () => void) => {
      e.preventDefault()
      // Keep focus in the list after the row goes away.
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])
      const next = rows[rows.indexOf(row) + 1] ?? rows[rows.indexOf(row) - 1]
      fn()
      next?.focus()
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'o') {
      e.preventDefault()
      onOpenRole(item.roleId)
    } else if (step && (e.key === 'd' || e.key === 'x')) act(() => done(item))
    else if (step && e.key === 's') act(() => snooze(item, 'tomorrow'))
    else if (step && e.key === 'w') act(() => snooze(item, 'next-week'))
  }

  /* ------------------------------------ drop ------------------------------------ */

  const dropProps = {
    onDragEnter: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      dragDepth.current++
      setDragging(true)
    },
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault()
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setDragging(false)
    },
    onDrop: (e: DragEvent) => {
      dragDepth.current = 0
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (!file) return
      e.preventDefault()
      setPasteOpen(true)
      readEmailFile(file)
        .then((raw) => setIncoming((cur) => ({ raw, n: (cur?.n ?? 0) + 1 })))
        .catch((err: Error) => toast(err.message, { tone: 'error' }))
    },
  }

  const loading = items == null && !error
  const nothing = items != null && items.length === 0
  const overdue = count('overdue')
  const dueToday = count('today')
  const dateLine = new Date(today + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="td" {...dropProps}>
      <div className="td-inner">
        <header className="td-head">
          <div>
            <h2>Today</h2>
            <p>
              {dateLine}
              {items != null && (
                <>
                  {' · '}
                  {overdue > 0 && (
                    <>
                      <strong className="is-overdue">{overdue} overdue</strong>
                      {' · '}
                    </>
                  )}
                  <strong>{dueToday} due today</strong>
                  {count('week') > 0 && ` · ${count('week')} this week`}
                </>
              )}
            </p>
          </div>
          <div className="td-head-actions">
            <button type="button" className={`btn btn-sm${pasteOpen ? ' btn-ghost' : ''}`} onClick={() => setPasteOpen((o) => !o)} aria-expanded={pasteOpen}>
              <MailIcon className="td-btn-icon" />
              {pasteOpen ? 'Hide email box' : 'Add an email'}
            </button>
          </div>
        </header>

        {error && (
          <div className="banner error">
            <Icon name="alert" />
            Couldn't load Today: {error}
            <button type="button" className="btn btn-sm" onClick={load}>
              Try again
            </button>
          </div>
        )}

        {(proposals.length > 0 || pasteOpen) && (
          <section className="td-section td-email" aria-labelledby="td-email-h">
            <div className="td-section-head">
              <h3 id="td-email-h">Email updates</h3>
              {proposals.length > 0 && <span className="td-count tabular">{proposals.length}</span>}
            </div>
            {proposals.length > 0 && (
              <div className="td-proposals">
                {proposals.map((p) => (
                  <ProposalCard key={p.id} p={p} role={byId.get(p.roleId) ?? null} onOpenRole={onOpenRole} onDone={(id) => setProposals((cur) => cur.filter((x) => x.id !== id))} />
                ))}
              </div>
            )}
            {pasteOpen && <EmailDrop roles={roles ?? []} incoming={incoming} autoFocus={!incoming} />}
          </section>
        )}

        {loading ? null : nothing ? (
          <TodayEmpty onPaste={() => setPasteOpen(true)} hasRoles={!!roles?.length} />
        ) : (
          <div ref={listRef} className="td-sections">
            {sections.length === 0 && (
              <div className="td-allclear">
                <Icon name="check" />
                All caught up. Nice work.
              </div>
            )}
            {sections.map((s) => (
              <section key={s.key} className={`td-section is-${s.key}`} aria-labelledby={`td-h-${s.key}`} style={{ marginBottom: 20 }}>
                <div className="td-section-head">
                  <h3 id={`td-h-${s.key}`}>{s.label}</h3>
                  <span className="td-count tabular">{s.items.length}</span>
                </div>
                <ul className="td-list">
                  {s.items.map((item) => (
                    <Row
                      key={keyOf(item)}
                      item={item}
                      section={s.key}
                      onKeyDown={(e) => onRowKey(e, item)}
                      onOpen={() => onOpenRole(item.roleId)}
                      onDone={() => done(item)}
                      onSnooze={(w) => snooze(item, w)}
                      today={today}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {sections.length > 0 && (
              <p className="td-keys" aria-hidden="true">
                <span>
                  <span className="kbd">↑</span>
                  <span className="kbd">↓</span>move
                </span>
                <span>
                  <span className="kbd">↵</span>open
                </span>
                <span>
                  <span className="kbd">D</span>done
                </span>
                <span>
                  <span className="kbd">S</span>tomorrow
                </span>
                <span>
                  <span className="kbd">W</span>next week
                </span>
              </p>
            )}
          </div>
        )}
      </div>
      {dragging && <div className="td-dropzone">Drop the email to read it</div>}
    </div>
  )
}

function Row({
  item,
  section,
  today,
  onKeyDown,
  onOpen,
  onDone,
  onSnooze,
}: {
  item: TodayItem
  section: TodaySectionKey
  today: string
  onKeyDown: (e: KeyboardEvent<HTMLLIElement>) => void
  onOpen: () => void
  onDone: () => void
  onSnooze: (w: SnoozeKey) => void
}) {
  const step = item.kind === 'next-step'
  const tone = section === 'overdue' ? ' is-overdue' : section === 'today' ? ' is-today' : section === 'undated' ? ' is-none' : ''
  const due = item.due ? dueLabel(item.due, item.time) : 'No date'
  const label = `${item.text}, ${item.company}, ${item.title}, ${item.kind === 'deadline' ? 'deadline ' : ''}${due}, ${stageLabel(item.stage)}`
  // Overdue and today rows always show their actions; later rows show them on hover or focus.
  const pinned = section === 'overdue' || section === 'today'
  return (
    <li className={`td-row${pinned ? ' is-pinned' : ''}`} data-row tabIndex={0} aria-label={label} onKeyDown={onKeyDown} onClick={onOpen}>
      <Monogram name={item.company} size={30} />
      <div className="td-row-main">
        <div className="td-row-step">
          <span>{item.text}</span>
        </div>
        <div className="td-row-sub">
          <strong>{item.company}</strong> · {item.title}
        </div>
      </div>
      <span className={`td-due${tone}`}>
        {step ? (
          capitalize(due)
        ) : (
          <>
            <Icon name="flag" className="td-due-flag" />
            Due {due}
          </>
        )}
      </span>
      <span className="td-stage" style={stageStyle(item.stage)}>
        {stageLabel(item.stage)}
      </span>
      {/* Fixed-width column so deadline rows (no actions) line up with step rows. Clicks here don't open the role. */}
      <div className="td-actions" onClick={(e) => e.stopPropagation()}>
        {step && (
          <>
            <button type="button" className="td-act is-done" onClick={onDone} title="Mark done (D)" aria-label={`Mark done: ${item.text}`}>
              <Icon name="check" />
            </button>
            <SnoozeMenu onSnooze={onSnooze} today={today} label={item.text} />
          </>
        )}
      </div>
    </li>
  )
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function SnoozeMenu({ onSnooze, today, label }: { onSnooze: (w: SnoozeKey) => void; today: string; label: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    ref.current?.querySelector<HTMLButtonElement>('.td-menu button')?.focus()
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const pick = (w: SnoozeKey) => {
    setOpen(false)
    onSnooze(w)
  }
  return (
    <div
      className="td-menu-wrap"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          ref.current?.querySelector<HTMLButtonElement>('.td-act')?.focus()
        }
      }}
    >
      <button
        type="button"
        className="td-act"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Snooze: ${label}`}
        onClick={() => setOpen((o) => !o)}
        title="Snooze (S tomorrow, W next week)"
      >
        <Icon name="clock" />
      </button>
      {open && (
        <div className="td-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => pick('tomorrow')}>
            Tomorrow
            <small>{shortDate(snoozeDate('tomorrow', today))}</small>
          </button>
          <button type="button" role="menuitem" onClick={() => pick('next-week')}>
            Next week
            <small>{shortDate(snoozeDate('next-week', today))}</small>
          </button>
        </div>
      )}
    </div>
  )
}

function TodayEmpty({ onPaste, hasRoles }: { onPaste: () => void; hasRoles: boolean }) {
  return (
    <div className="td-empty">
      <span className="td-empty-icon">
        <Icon name="sun" />
      </span>
      <h3>Nothing scheduled yet</h3>
      <p>
        Next steps and deadlines from your board show up here, sorted into overdue, today, this week and later.
        {hasRoles ? ' Open a role and add a next step with a date, or let recruiter emails suggest them.' : ' Add a role to your board first, then give it a next step with a date.'}
      </p>
      <div className="td-empty-actions">
        <button type="button" className="btn" onClick={onPaste}>
          <MailIcon className="td-btn-icon" />
          Paste an email
        </button>
        <button type="button" className="btn btn-primary" onClick={() => openSettings('email')}>
          Connect email
          <Icon name="arrowRight" />
        </button>
      </div>
    </div>
  )
}
