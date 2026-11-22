import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { STAGES, STAGE_KEYS, type Role, type StageKey } from '@shared/roles'
import { Icon } from '@renderer/components/Icon'
import { RoleCard } from './RoleCard'
import './board.css'

interface Props {
  roles: Role[]
  query: string
  onOpen: (id: string) => void
  onAdd: (stage: StageKey) => void
  onMove: (id: string, stage: StageKey, index: number) => void
  /** Stage the top bar asked to show; the board scrolls to it and expands it if collapsed. */
  focusStage: { stage: StageKey; n: number } | null
}

/** Terminal stages start as narrow lanes so the four active stages get the room. */
const COLLAPSIBLE: StageKey[] = ['rejected', 'closed']
const COLLAPSE_KEY = 'board.collapsed'

function loadCollapsed(): Set<StageKey> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    if (raw) return new Set(JSON.parse(raw) as StageKey[])
  } catch {
    /* storage unavailable: use the default */
  }
  return new Set(COLLAPSIBLE)
}

interface DragState {
  id: string
  stage: StageKey
  /** Position among the visible cards of `stage`, dragged card excluded. */
  index: number
  height: number
}

export function matchesQuery(r: Role, query: string): boolean {
  if (!query) return true
  const hay = [r.company, r.title, r.location, r.notes, r.priority].join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w))
}

export function byStage(roles: Role[]): Record<StageKey, Role[]> {
  const out = Object.fromEntries(STAGE_KEYS.map((k) => [k, [] as Role[]])) as Record<StageKey, Role[]>
  for (const r of roles) out[r.stage]?.push(r)
  for (const k of STAGE_KEYS) out[k].sort((a, b) => a.order - b.order || a.company.localeCompare(b.company))
  return out
}

export function Board({ roles, query, onOpen, onAdd, onMove, focusStage }: Props) {
  const grouped = useMemo(() => byStage(roles), [roles])
  const [collapsed, setCollapsed] = useState<Set<StageKey>>(loadCollapsed)
  const [edges, setEdges] = useState({ left: false, right: false })
  const [announce, setAnnounce] = useState('')
  const toggleCollapsed = useCallback((stage: StageKey, open?: boolean) => {
    setCollapsed((cur) => {
      const next = new Set(cur)
      const shouldOpen = open ?? next.has(stage)
      if (shouldOpen) next.delete(stage)
      else next.add(stage)
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]))
      } catch {
        /* not persisted */
      }
      return next
    })
  }, [])
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const pending = useRef<{ id: string; x: number; y: number; pid: number; el: HTMLElement; offX: number; offY: number } | null>(
    null,
  )
  const ghostRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const suppressClick = useRef(false)
  const [ghostRole, setGhostRole] = useState<{ role: Role; width: number } | null>(null)

  const setDragBoth = (d: DragState | null) => {
    dragRef.current = d
    setDrag(d)
  }

  const locate = useCallback((x: number, y: number) => {
    const d = dragRef.current
    if (!d) return
    const body = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-stage-body]')
    if (!body) return
    const stage = body.dataset['stageBody'] as StageKey
    const cards = [...body.querySelectorAll<HTMLElement>('[data-card]')]
    let index = cards.findIndex((c) => {
      const r = c.getBoundingClientRect()
      return y < r.top + r.height / 2
    })
    if (index < 0) index = cards.length
    if (stage !== d.stage || index !== d.index) setDragBoth({ ...d, stage, index })
  }, [])

  // Pointer tracking lives on window so a drag survives leaving the board.
  useEffect(() => {
    let raf = 0
    const placeGhost = () => {
      const p = pending.current
      if (ghostRef.current && p) {
        ghostRef.current.style.transform = `translate(${pointer.current.x - p.offX}px, ${pointer.current.y - p.offY}px) rotate(1.2deg)`
      }
    }
    const autoScroll = () => {
      if (!dragRef.current) return
      const b = boardRef.current?.getBoundingClientRect()
      const { x, y } = pointer.current
      if (b && boardRef.current) {
        const edge = 64
        if (x < b.left + edge) boardRef.current.scrollLeft -= Math.ceil((b.left + edge - x) / 5)
        else if (x > b.right - edge) boardRef.current.scrollLeft += Math.ceil((x - (b.right - edge)) / 5)
      }
      const body = document.querySelector<HTMLElement>(`[data-stage-body="${dragRef.current.stage}"]`)
      if (body) {
        const r = body.getBoundingClientRect()
        if (y < r.top + 36) body.scrollTop -= 8
        else if (y > r.bottom - 36) body.scrollTop += 8
      }
      locate(x, y)
      raf = requestAnimationFrame(autoScroll)
    }
    const onMoveEv = (e: PointerEvent) => {
      const p = pending.current
      if (!p || e.pointerId !== p.pid) return
      pointer.current = { x: e.clientX, y: e.clientY }
      if (!dragRef.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return
        const role = roles.find((r) => r.id === p.id)
        if (!role) return
        const visible = grouped[role.stage].filter((r) => matchesQuery(r, query))
        const rect = p.el.getBoundingClientRect()
        setGhostRole({ role, width: rect.width })
        setDragBoth({ id: p.id, stage: role.stage, index: visible.findIndex((r) => r.id === p.id), height: rect.height })
        document.body.classList.add('is-dragging')
        raf = requestAnimationFrame(autoScroll)
      }
      e.preventDefault()
      placeGhost()
      locate(e.clientX, e.clientY)
    }
    const finish = (commit: boolean) => {
      const d = dragRef.current
      pending.current = null
      cancelAnimationFrame(raf)
      document.body.classList.remove('is-dragging')
      setGhostRole(null)
      setDragBoth(null)
      if (!d) return
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      if (!commit) return
      // Map the index among visible cards onto the full column, so filtering never scrambles order.
      const full = grouped[d.stage].filter((r) => r.id !== d.id)
      const visible = full.filter((r) => matchesQuery(r, query))
      const anchor = visible[d.index]
      const fullIndex = anchor ? full.findIndex((r) => r.id === anchor.id) : full.length
      const cur = roles.find((r) => r.id === d.id)
      const curIndex = cur ? grouped[cur.stage].filter((r) => r.id !== d.id).findIndex((r) => r.order > cur.order) : -1
      const unchanged = cur && cur.stage === d.stage && (curIndex === -1 ? full.length : curIndex) === fullIndex
      if (!unchanged) {
        onMove(d.id, d.stage, fullIndex)
        setAnnounce(`Moved ${cur?.company ?? 'role'} to ${STAGES.find((s) => s.key === d.stage)?.label}`)
      }
    }
    const onUp = (e: PointerEvent) => {
      if (!pending.current || e.pointerId !== pending.current.pid) return
      // Only commit when released over a column; letting go anywhere else cancels.
      const over = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-stage-body]')
      finish(!dragRef.current || !!over)
    }
    const onCancel = (e: PointerEvent) => {
      if (pending.current && e.pointerId === pending.current.pid) finish(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) finish(false)
    }
    window.addEventListener('pointermove', onMoveEv, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMoveEv)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
    }
  }, [roles, grouped, query, locate, onMove])

  useEffect(() => {
    if (ghostRole && ghostRef.current && pending.current) {
      const p = pending.current
      ghostRef.current.style.transform = `translate(${pointer.current.x - p.offX}px, ${pointer.current.y - p.offY}px) rotate(1.2deg)`
    }
  }, [ghostRole])

  const startPointer = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return
    const onGrip = !!(e.target as HTMLElement).closest('[data-grip]')
    if (e.pointerType !== 'mouse' && !onGrip) return
    if ((e.target as HTMLElement).closest('a,button:not([data-grip])')) return
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    pointer.current = { x: e.clientX, y: e.clientY }
    pending.current = { id, x: e.clientX, y: e.clientY, pid: e.pointerId, el, offX: e.clientX - rect.left, offY: e.clientY - rect.top }
  }

  const moveByKey = (role: Role, dir: -1 | 1) => {
    const i = STAGE_KEYS.indexOf(role.stage) + dir
    const stage = STAGE_KEYS[i]
    if (!stage) return
    if (collapsed.has(stage)) toggleCollapsed(stage, true)
    onMove(role.id, stage, grouped[stage].length)
    setAnnounce(`Moved ${role.company} to ${STAGES.find((s) => s.key === stage)?.label}`)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card="${role.id}"]`)?.focus())
  }

  // Fade the edges when columns continue off-screen, so overflow is visible.
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const update = () =>
      setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [collapsed])

  useEffect(() => {
    if (!focusStage) return
    if (collapsed.has(focusStage.stage)) toggleCollapsed(focusStage.stage, true)
    requestAnimationFrame(() => {
      const col = boardRef.current?.querySelector<HTMLElement>(`[data-col="${focusStage.stage}"]`)
      if (!col) return
      col.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
      col.classList.remove('is-flash')
      void col.offsetWidth
      col.classList.add('is-flash')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusStage])

  return (
    <div
      className={`board${edges.left ? ' fade-left' : ''}${edges.right ? ' fade-right' : ''}`}
      ref={boardRef}
      role="list"
      aria-label="Application stages"
    >
      <span id="card-keys-hint" className="visually-hidden">
        Enter or Space opens the role. Shift plus left or right arrow moves it to the previous or next stage.
      </span>
      <div className="visually-hidden" aria-live="polite">
        {announce}
      </div>
      {STAGES.map((s) => {
        const all = grouped[s.key]
        const visible = all.filter((r) => matchesQuery(r, query) && r.id !== drag?.id)
        const isTarget = drag?.stage === s.key
        if (collapsed.has(s.key)) {
          return (
            <section
              key={s.key}
              data-col={s.key}
              className={`col is-collapsed${isTarget ? ' is-target' : ''}`}
              style={{ ['--stage' as string]: `var(--stage-${s.key})` }}
              role="listitem"
            >
              <button
                type="button"
                className="lane"
                data-stage-body={s.key}
                onClick={() => toggleCollapsed(s.key, true)}
                aria-label={`${s.label}, ${all.length} roles. Expand`}
                title={`Show ${s.label}`}
              >
                <span className="col-dot" />
                <span className="lane-count tabular">{all.length}</span>
                <span className="lane-label">{s.label}</span>
              </button>
            </section>
          )
        }
        return (
          <section
            data-col={s.key}
            key={s.key}
            className={`col${isTarget ? ' is-target' : ''}`}
            style={{ ['--stage' as string]: `var(--stage-${s.key})` }}
            aria-label={`${s.label}, ${all.length} roles`}
            role="listitem"
          >
            <header className="col-head">
              <span className="col-dot" />
              <h2>{s.label}</h2>
              <span className="col-count tabular">{query ? `${visible.length}/${all.length}` : all.length}</span>
              <span className="col-actions">
                {COLLAPSIBLE.includes(s.key) && (
                  <button
                    type="button"
                    className="icon-btn col-add"
                    onClick={() => toggleCollapsed(s.key, false)}
                    aria-label={`Collapse ${s.label}`}
                    title="Collapse"
                  >
                    <Icon name="collapse" />
                  </button>
                )}
                <button type="button" className="icon-btn col-add" onClick={() => onAdd(s.key)} aria-label={`Add a role to ${s.label}`} title={`Add to ${s.label}`}>
                  <Icon name="plus" />
                </button>
              </span>
            </header>
            <div className="col-body" data-stage-body={s.key}>
              {visible.map((r, i) => (
                <FragmentWithPlaceholder key={r.id} show={isTarget && drag?.index === i} height={drag?.height ?? 0}>
                  <RoleCard
                    role={r}
                    onPointerDown={(e) => startPointer(e, r.id)}
                    onClick={() => {
                      if (!suppressClick.current) onOpen(r.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpen(r.id)
                      }
                      else if (e.shiftKey && e.key === 'ArrowRight') {
                        e.preventDefault()
                        moveByKey(r, 1)
                      } else if (e.shiftKey && e.key === 'ArrowLeft') {
                        e.preventDefault()
                        moveByKey(r, -1)
                      }
                    }}
                  />
                </FragmentWithPlaceholder>
              ))}
              {isTarget && drag && drag.index >= visible.length && (
                <div className="placeholder" style={{ height: drag.height }} />
              )}
              {!visible.length && !isTarget && (
                <div className="col-empty">{query && all.length ? 'No matches' : emptyCopy(s.key)}</div>
              )}
            </div>
          </section>
        )
      })}
      {ghostRole &&
        createPortal(
          <div className="ghost" ref={ghostRef} style={{ width: ghostRole.width }}>
            <RoleCard role={ghostRole.role} ghost />
          </div>,
          document.body,
        )}
    </div>
  )
}

function FragmentWithPlaceholder({ show, height, children }: { show: boolean; height: number; children: React.ReactNode }) {
  return (
    <>
      {show && <div className="placeholder" style={{ height }} />}
      {children}
    </>
  )
}

function emptyCopy(stage: StageKey): string {
  switch (stage) {
    case 'saved':
      return 'Roles you want to apply to'
    case 'applied':
      return 'Drag a role here once you apply'
    case 'interviewing':
      return 'Screens and interviews land here'
    case 'offer':
      return 'Offers to weigh'
    case 'rejected':
      return 'Not this time'
    case 'closed':
      return 'Closed or skipped postings'
  }
}
