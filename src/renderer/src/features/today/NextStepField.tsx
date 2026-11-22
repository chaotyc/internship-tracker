import type { NextStep } from '@shared/roles'
import { addDays, localIso } from '@shared/today'
import { Icon } from '@renderer/components/Icon'
import { daysUntil } from '@renderer/lib/format'
import { dueLabel } from '@renderer/features/board/RoleCard'
import './today.css'

const EMPTY: NextStep = { text: '', due: '', time: '', done: false, source: 'manual' }

/** The coming Monday (tomorrow, if today is Sunday). */
function comingMonday(today: string): string {
  const dow = new Date(today + 'T12:00:00').getDay()
  return addDays(today, ((8 - dow) % 7) || 7)
}

const SOURCE_NOTE: Record<NextStep['source'], string> = { manual: '', email: 'From an email', chat: 'Suggested by the assistant' }

/** The role's one next step: what, when, quick dates, done and clear. */
export function NextStepField({ value, onChange }: { value: NextStep | null; onChange: (v: NextStep | null) => void }) {
  const v: NextStep = value ?? EMPTY
  const today = localIso()
  const set = (patch: Partial<NextStep>) => {
    // Editing a step makes it the user's own again and reopens it.
    const next: NextStep = { ...v, source: 'manual', done: false, ...patch }
    if (!next.due) next.time = ''
    onChange(next.text.trim() || next.due ? next : null)
  }
  const chips: { label: string; due: string; title: string }[] = [
    { label: 'Today', due: today, title: 'Due today' },
    { label: 'Tomorrow', due: addDays(today, 1), title: 'Due tomorrow' },
    { label: 'Next Mon', due: comingMonday(today), title: 'Due next Monday' },
    { label: '+1 week', due: addDays(v.due || today, 7), title: v.due ? 'A week after the current date' : 'A week from today' },
  ]
  const has = !!(v.text || v.due)
  const d = v.due ? daysUntil(v.due) : null
  const status = v.done
    ? { tone: 'is-done', text: 'Done' }
    : d == null
      ? { tone: '', text: has ? 'No date yet' : '' }
      : { tone: d < 0 ? 'is-overdue' : d === 0 ? 'is-today' : '', text: d < 0 ? dueLabel(v.due, v.time) : `Due ${dueLabel(v.due, v.time)}` }

  return (
    <div className={`field wide ns${v.done ? ' is-done' : ''}`} role="group" aria-labelledby="ns-label">
      <span id="ns-label">Next step</span>
      <div className="ns-row">
        <input value={v.text} placeholder="e.g. Finish the take-home" onChange={(e) => set({ text: e.target.value })} aria-label="Next step" />
        <input type="date" className={v.due ? undefined : 'is-empty'} value={v.due} onChange={(e) => set({ due: e.target.value })} aria-label="Next step date" />
        <input type="time" value={v.time} disabled={!v.due} onChange={(e) => set({ time: e.target.value })} aria-label="Next step time" />
      </div>
      <div className="ns-tools">
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            className="ns-chip"
            title={c.title}
            aria-pressed={c.label !== '+1 week' && v.due === c.due}
            onClick={() => set({ due: c.due })}
          >
            {c.label}
          </button>
        ))}
        {(status.text || SOURCE_NOTE[v.source]) && <span className="ns-sep" aria-hidden="true" />}
        {status.text && (
          <span className={`ns-status ${status.tone}`} aria-live="polite">
            {status.text}
          </span>
        )}
        {has && SOURCE_NOTE[v.source] && <span className="ns-src">· {SOURCE_NOTE[v.source]}</span>}
        {has && (
          <span className="ns-end">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...v, done: !v.done })}>
              <Icon name={v.done ? 'refresh' : 'check'} />
              {v.done ? 'Reopen' : 'Mark done'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)} aria-label="Clear next step">
              <Icon name="close" />
              Clear
            </button>
          </span>
        )}
      </div>
    </div>
  )
}
