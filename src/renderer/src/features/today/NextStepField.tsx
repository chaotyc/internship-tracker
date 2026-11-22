import { useRef } from 'react'
import type { NextStep } from '@shared/roles'
import { addDays, localIso } from '@shared/today'
import { Icon } from '@renderer/components/Icon'
import { daysUntil, dueLabel } from '@renderer/lib/format'
import './today.css'

const EMPTY: NextStep = { text: '', due: '', time: '', done: false, source: 'manual' }

/** The coming Monday (tomorrow, if today is Sunday). */
function comingMonday(today: string): string {
  const dow = new Date(today + 'T12:00:00').getDay()
  return addDays(today, ((8 - dow) % 7) || 7)
}

/** "Sun, Nov 22" (year only when it isn't this year), matching DateField. */
function fullDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return iso
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "2pm" or "2:30pm" for an HH:MM string. */
function timeLabel(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`
}

/** 7am to 10pm in 30-minute steps, stored as HH:MM. */
const TIMES = Array.from({ length: 31 }, (_, i) => {
  const min = 7 * 60 + i * 30
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
})

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const SOURCE_NOTE: Record<NextStep['source'], string> = { manual: '', email: 'From an email', chat: 'Suggested by the assistant' }

/** The role's one next step: what, when, quick dates and done. */
export function NextStepField({ value, onChange }: { value: NextStep | null; onChange: (v: NextStep | null) => void }) {
  const v: NextStep = value ?? EMPTY
  const today = localIso()
  const picker = useRef<HTMLInputElement>(null)
  const openPicker = () => {
    const el = picker.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.focus()
    }
  }
  const set = (patch: Partial<NextStep>) => {
    // Editing a step makes it the user's own again and reopens it.
    const next: NextStep = { ...v, source: 'manual', done: false, ...patch }
    if (!next.due) next.time = ''
    onChange(next.text.trim() || next.due ? next : null)
  }
  const chips: { label: string; due: string; title: string }[] = [
    { label: 'Today', due: today, title: 'Set for today' },
    { label: 'Tomorrow', due: addDays(today, 1), title: 'Set for tomorrow' },
    { label: 'Next Mon', due: comingMonday(today), title: 'Set for next Monday' },
    { label: '+1 week', due: addDays(v.due || today, 7), title: v.due ? 'A week after the current date' : 'A week from today' },
  ]
  const has = !!(v.text || v.due)
  const d = v.due ? daysUntil(v.due) : null
  const status = v.done
    ? { tone: 'is-done', text: 'Done' }
    : d == null
      ? { tone: '', text: has ? 'No date yet' : '' }
      : { tone: d < 0 ? 'is-overdue' : d === 0 ? 'is-today' : '', text: capitalize(dueLabel(v.due, v.time)) }

  return (
    <div className={`field wide ns${v.done ? ' is-done' : ''}`} role="group" aria-labelledby="ns-label">
      <span id="ns-label">Next step</span>
      <div className="ns-row">
        <input value={v.text} placeholder="e.g. Finish the take-home" onChange={(e) => set({ text: e.target.value })} aria-label="Next step" />
        {/* Same readable date button as the dialog's other dates (DateField), over a hidden native picker. */}
        <div className="date-field">
          <button type="button" className={`date-btn${v.due ? '' : ' is-empty'}`} onClick={openPicker} aria-label={v.due ? `Next step date, ${fullDate(v.due)}` : 'Next step date'}>
            <Icon name="clock" />
            <span>{v.due ? fullDate(v.due) : 'Add a date'}</span>
          </button>
          {v.due && (
            <button type="button" className="date-clear" onClick={() => set({ due: '' })} aria-label="Clear next step date">
              <Icon name="close" />
            </button>
          )}
          <input ref={picker} type="date" className="date-native" value={v.due} onChange={(e) => set({ due: e.target.value })} tabIndex={-1} aria-hidden="true" />
        </div>
        <select className={v.time ? undefined : 'is-empty'} value={v.time} disabled={!v.due} onChange={(e) => set({ time: e.target.value })} aria-label="Next step time">
          <option value="">No time</option>
          {/* Keep an off-grid time (e.g. 9:15) that came from an email or the assistant. */}
          {v.time && !TIMES.includes(v.time) && <option value={v.time}>{timeLabel(v.time)}</option>}
          {TIMES.map((t) => (
            <option key={t} value={t}>
              {timeLabel(t)}
            </option>
          ))}
        </select>
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
          </span>
        )}
      </div>
    </div>
  )
}
