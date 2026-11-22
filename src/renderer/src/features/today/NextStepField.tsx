import { useRef } from 'react'
import type { NextStep } from '@shared/roles'
import { addDays, localIso } from '@shared/today'
import { Icon } from '@renderer/components/Icon'
import { ago, daysUntil } from '@renderer/lib/format'
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

/** "today", "tomorrow", "in 3 days" or "2d ago", matching DateField's suffix. */
function relative(iso: string): string {
  const n = daysUntil(iso)
  if (n == null) return ''
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n < 0) return ago(iso)
  return `in ${n} days`
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
  // The date button says how far off the step is ("· in 3 days", "· 2d ago"), like DateField; overdue reads red.
  const overdue = !v.done && d != null && d < 0

  return (
    <div className={`field wide ns${v.done ? ' is-done' : ''}`} role="group" aria-labelledby="ns-label">
      <span id="ns-label">Next step</span>
      <div className="ns-row">
        <input value={v.text} placeholder="e.g. Finish the take-home" onChange={(e) => set({ text: e.target.value })} aria-label="Next step" />
        {/* Same readable date button as the dialog's other dates (DateField), over a hidden native picker. */}
        <div className="date-field">
          <button type="button" className={`date-btn${v.due ? '' : ' is-empty'}`} onClick={openPicker} aria-label={v.due ? `Next step date, ${fullDate(v.due)}` : 'Next step date'}>
            <Icon name="calendar" />
            {v.due ? (
              <span>
                {fullDate(v.due)}
                <small className={overdue ? 'is-overdue' : undefined}> · {relative(v.due)}</small>
              </span>
            ) : (
              <span>Add a date</span>
            )}
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
        {has && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...v, done: !v.done })}>
            <Icon name={v.done ? 'refresh' : 'check'} />
            {v.done ? 'Reopen' : 'Mark done'}
          </button>
        )}
        {v.done && (
          <span className="ns-status is-done" aria-live="polite">
            Done
          </span>
        )}
        {has && SOURCE_NOTE[v.source] && <span className="ns-src">{SOURCE_NOTE[v.source]}</span>}
        <span className="ns-chips">
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
        </span>
      </div>
    </div>
  )
}
