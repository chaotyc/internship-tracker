import { useRef } from 'react'
import { daysUntil } from '@renderer/lib/format'
import { Icon } from './Icon'

/** "Thu, Nov 26" for a YYYY-MM-DD string. */
function fullDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return iso
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

function relative(iso: string): string {
  const n = daysUntil(iso)
  if (n == null) return ''
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

interface Props {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}

/**
 * A date shown as readable text ("Thu, Nov 26 · in 4 days") that opens the
 * system date picker on click, instead of a bare mm/dd/yyyy field.
 */
export function DateField({ id, label, value, onChange, placeholder = 'Add a date', className }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const open = () => {
    const el = input.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.focus()
    }
  }
  return (
    <div className={`field${className ? ' ' + className : ''}`}>
      <span id={`${id}-label`}>{label}</span>
      <div className="date-field">
        <button type="button" id={id} className={`date-btn${value ? '' : ' is-empty'}`} onClick={open} aria-labelledby={`${id}-label ${id}`}>
          <Icon name="calendar" />
          {value ? (
            <span>
              {fullDate(value)}
              <small> · {relative(value)}</small>
            </span>
          ) : (
            <span>{placeholder}</span>
          )}
        </button>
        {value && (
          <button type="button" className="date-clear" onClick={() => onChange('')} aria-label={`Clear ${label.toLowerCase()}`}>
            <Icon name="close" />
          </button>
        )}
        <input
          ref={input}
          type="date"
          className="date-native"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
