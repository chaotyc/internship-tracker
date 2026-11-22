import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BOARD_NAMES, type AutofillBoard, type AutofillReport, type AutofillStep } from '@shared/autofill'
import { Icon } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import './autofill.css'

type State =
  | { kind: 'idle' }
  | { kind: 'running'; step: AutofillStep; message: string }
  | { kind: 'done'; report: AutofillReport }
  | { kind: 'error'; message: string }

const STEP_LABEL: Partial<Record<AutofillStep, string>> = {
  opening: 'Opening…',
  filling: 'Filling…',
  resume: 'Attaching resume…',
}

/**
 * Shown in the role dialog when the posting is a Greenhouse, Ashby or Lever application. Fills it in its own window; never submits.
 * `blockedReason` keeps it in place but disabled (e.g. unsaved link or track changes), with the reason as its tooltip.
 * `ghost` is the quiet footer variant, used once the role is past Saved.
 */
export function AutofillButton({
  roleId,
  link,
  blockedReason,
  ghost,
  onOpenSettings,
}: {
  roleId: string
  link: string
  blockedReason?: string
  ghost?: boolean
  /** Lets the host (the role dialog) guard unsaved changes before Settings opens. */
  onOpenSettings?: () => void
}) {
  // null until the first check answers: the slot is reserved so the header doesn't shift.
  const [board, setBoard] = useState<AutofillBoard | '' | null>(null)
  const supported = !!board
  const [state, setState] = useState<State>({ kind: 'idle' })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // Ask main whether the link is an application autofill can fill. Debounced while the link is being edited.
  useEffect(() => {
    let live = true
    const url = link.trim()
    const t = setTimeout(() => {
      api
        .invoke('autofill:supported', { url })
        .then((r) => live && setBoard(r.supported ? r.board : ''))
        .catch(() => live && setBoard(''))
    }, 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [link])

  useEffect(() => {
    setState({ kind: 'idle' })
    setBoard(null)
  }, [roleId])

  useEffect(
    () =>
      api.on('autofill:progress', (p) => {
        if (p.roleId !== roleId) return
        setState((s) => (s.kind === 'running' && STEP_LABEL[p.step] ? { kind: 'running', step: p.step, message: p.message } : s))
      }),
    [roleId],
  )

  const place = useCallback(() => {
    const pop = popRef.current
    const btn = btnRef.current
    if (!pop || !btn) return
    const r = btn.getBoundingClientRect()
    const width = pop.offsetWidth
    const left = Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12))
    pop.style.left = `${left}px`
    // Below the button when it fits (header); above it otherwise (footer).
    const below = r.bottom + 8
    const fitsBelow = below + pop.offsetHeight <= window.innerHeight - 12
    pop.style.top = `${fitsBelow ? below : Math.max(12, r.top - 8 - pop.offsetHeight)}px`
  }, [])

  const showPop = useCallback(() => {
    const pop = popRef.current
    if (!pop) return
    if (!pop.matches(':popover-open')) pop.showPopover()
    place()
  }, [place])

  // Open the result popover once there is something to show.
  useLayoutEffect(() => {
    if (state.kind === 'done' || state.kind === 'error') showPop()
  }, [state, showPop])

  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [place])

  const run = async () => {
    if (state.kind === 'running') return
    popRef.current?.hidePopover?.()
    setState({ kind: 'running', step: 'opening', message: 'Opening the application…' })
    try {
      const report = await api.invoke('autofill:open', { roleId })
      setState({ kind: 'done', report })
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message })
    }
  }

  const openSettings = () => {
    popRef.current?.hidePopover()
    if (onOpenSettings) return onOpenSettings()
    // App closes the role dialog and opens Settings on the Profile tab.
    window.dispatchEvent(new CustomEvent('app:open-settings', { detail: 'profile' }))
  }

  if (board === '') return null
  const running = state.kind === 'running'
  const blocked = !running && !!blockedReason

  return (
    <>
      {/* The wrapper carries the tooltip, since a disabled button gets no hover events. */}
      <span className={`af-slot${supported ? '' : ' is-pending'}`} title={blocked ? blockedReason : undefined} aria-hidden={supported ? undefined : true}>
        <button
          ref={btnRef}
          type="button"
          className={`btn af-btn${ghost ? ' btn-ghost is-ghost' : ''}${running ? ' is-running' : ''}`}
          onClick={() => void run()}
          disabled={running || blocked || !supported}
          aria-busy={running}
          tabIndex={supported ? undefined : -1}
          title={
            blocked
              ? undefined
              : `Opens the ${board ? BOARD_NAMES[board] : ''} application in its own window and fills it from your profile. You review and submit.`
          }
        >
          {running ? <span className="af-spinner" aria-hidden="true" /> : <Icon name="wand" />}
          {running ? STEP_LABEL[state.step] ?? 'Working…' : ghost ? 'Autofill' : 'Autofill application'}
        </button>
      </span>
      <div ref={popRef} popover="auto" className="af-pop" role="dialog" aria-label="Autofill result">
        {state.kind === 'done' && state.report.profileEmpty && <EmptyProfile onOpenSettings={openSettings} onClose={() => popRef.current?.hidePopover()} />}
        {state.kind === 'done' && !state.report.profileEmpty && <Result report={state.report} onClose={() => popRef.current?.hidePopover()} />}
        {state.kind === 'error' && (
          <>
            <header className="af-head">
              <span className="af-mark is-danger">
                <Icon name="alert" />
              </span>
              <div className="af-title">
                <strong>Autofill stopped</strong>
                <p>{state.message}</p>
              </div>
              <CloseButton onClose={() => popRef.current?.hidePopover()} />
            </header>
          </>
        )}
      </div>
    </>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="icon-btn af-close" onClick={onClose} aria-label="Close">
      <Icon name="close" />
    </button>
  )
}

function EmptyProfile({ onOpenSettings, onClose }: { onOpenSettings: () => void; onClose: () => void }) {
  return (
    <>
      <header className="af-head">
        <span className="af-mark is-warn">
          <Icon name="user" />
        </span>
        <div className="af-title">
          <strong>Your profile is empty</strong>
          <p>Autofill uses your saved name, contact details and education. Add them in Settings &gt; Profile, then try again.</p>
        </div>
        <CloseButton onClose={onClose} />
      </header>
      <footer className="af-foot">
        <button type="button" className="btn btn-sm btn-primary" onClick={onOpenSettings}>
          <Icon name="settings" />
          Open Settings
        </button>
      </footer>
    </>
  )
}

function Result({ report, onClose }: { report: AutofillReport; onClose: () => void }) {
  const n = report.filled.length
  return (
    <>
      <header className="af-head">
        <span className="af-mark">
          <Icon name="check" />
        </span>
        <div className="af-title">
          <strong className="tabular">
            Filled {n} field{n === 1 ? '' : 's'}
          </strong>
          <p>Review everything in the application window, then submit it yourself.</p>
        </div>
        <CloseButton onClose={onClose} />
      </header>
      <div className="af-chips">
        <span className={`chip af-resume ${report.resumeAttached ? 'ok' : 'warn'}`} title={report.resumeFile ?? undefined}>
          <Icon name={report.resumeAttached ? 'check' : 'file'} />
          <span className="af-resume-name">{report.resumeAttached && report.resumeFile ? report.resumeFile : 'Resume not attached'}</span>
        </span>
        {report.needsYou.length === 0 && (
          <span className="chip ok">
            <Icon name="check" />
            No required fields empty
          </span>
        )}
      </div>
      {report.needsYou.length > 0 && (
        <section className="af-needs">
          <h4>
            Needs you <span className="tabular">{report.needsYou.length}</span>
          </h4>
          <ul>
            {report.needsYou.slice(0, 8).map((label) => (
              <li key={label} title={label}>
                {label}
              </li>
            ))}
          </ul>
          {report.needsYou.length > 8 && <p className="af-more">and {report.needsYou.length - 8} more, outlined in the form</p>}
        </section>
      )}
      {report.notes.length > 0 && (
        <ul className="af-notes">
          {report.notes.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </>
  )
}
