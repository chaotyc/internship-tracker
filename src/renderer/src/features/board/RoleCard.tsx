import type { HTMLAttributes } from 'react'
import type { Fit, Role } from '@shared/roles'
import { Icon } from '@renderer/components/Icon'
import { daysUntil, deadlineLabel, dueLabel, hueFor, monogram, shortDate } from '@renderer/lib/format'

interface Props extends Omit<HTMLAttributes<HTMLElement>, 'role'> {
  role: Role
  ghost?: boolean
}

export function Monogram({ name, size = 28 }: { name: string; size?: number }) {
  const h = hueFor(name)
  return (
    <span
      className="monogram"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        ['--mono-h' as string]: h,
      }}
    >
      {monogram(name)}
    </span>
  )
}

const FIT_LEVEL: Record<Exclude<Fit, ''>, number> = { Strong: 4, Good: 3, Moderate: 2, Weak: 1 }

/** Fit is context, not an alarm: neutral text with a four-step meter. */
export function FitMeter({ fit }: { fit: Fit }) {
  if (!fit) return null
  const level = FIT_LEVEL[fit]
  return (
    <span className="fit-meter" title={`${fit} fit`}>
      <span className="fit-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= level ? 'on' : ''} />
        ))}
      </span>
      {fit} fit
    </span>
  )
}

interface Flag {
  tone: 'danger' | 'warn'
  label: string
  text?: string
  title?: string
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * The one thing on a role that needs attention now, if any: a next step that is overdue or
 * due today, a closed posting, or a deadline within three days. Everything else (location,
 * pay, fit, notes, later steps) lives in the role dialog.
 */
function attention(role: Role): Flag | null {
  if (role.stage === 'rejected' || role.stage === 'closed') return null
  const saved = role.stage === 'saved'
  const live = role.liveness?.status
  const step = role.nextStep
  if (step && !step.done && step.due) {
    const d = daysUntil(step.due)
    if (d != null && d <= 0) {
      return { tone: d < 0 ? 'danger' : 'warn', label: d < 0 ? 'Overdue' : capitalize(dueLabel(step.due, step.time)), text: step.text || 'Next step' }
    }
  }
  if (saved && live === 'closed') return { tone: 'danger', label: 'Posting closed', title: role.liveness.detail }
  if (role.deadline) {
    const d = daysUntil(role.deadline)
    if (d != null && d <= 3) return { tone: 'danger', label: deadlineLabel(role.deadline), title: `Deadline ${shortDate(role.deadline)}` }
  }
  if (saved && live === 'expiring') return { tone: 'warn', label: 'Closing soon', title: role.liveness.detail }
  return null
}

export function RoleCard({ role, ghost, ...rest }: Props) {
  const saved = role.stage === 'saved'
  const finished = role.stage === 'rejected' || role.stage === 'closed'
  const flag = attention(role)
  const flagTitle = flag ? (flag.title ?? [flag.label, flag.text].filter(Boolean).join(' · ')) : undefined
  return (
    <article
      className={`card${ghost ? ' is-ghost' : ''}${role.liveness?.status === 'closed' && saved ? ' is-stale' : ''}${finished ? ' is-finished' : ''}`}
      data-card={ghost ? undefined : role.id}
      tabIndex={ghost ? -1 : 0}
      aria-label={`${role.company}, ${role.title}${flagTitle ? `. ${flagTitle}` : ''}`}
      aria-describedby={ghost ? undefined : 'card-keys-hint'}
      {...rest}
    >
      <div className="card-top">
        <Monogram name={role.company} />
        <div className="card-heading">
          <div className="card-company">{role.company}</div>
          <div className="card-title" title={role.title}>
            {role.title}
          </div>
        </div>
        <div className="card-tools">
          {role.link && !ghost && (
            <a
              className="card-tool"
              href={role.link}
              target="_blank"
              rel="noreferrer"
              title="Open posting"
              aria-label={`Open the ${role.company} posting`}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Icon name="external" />
            </a>
          )}
          <button
            type="button"
            className="card-tool card-grip"
            data-grip
            tabIndex={-1}
            aria-hidden="true"
            title="Drag to move · Shift+←/→ moves between stages"
          >
            <Icon name="grip" />
          </button>
        </div>
      </div>
      {flag && (
        <div className={`card-flag is-${flag.tone}`} title={flagTitle}>
          <span className="card-flag-label">{flag.label}</span>
          {flag.text && <span className="card-flag-text">{flag.text}</span>}
        </div>
      )}
    </article>
  )
}
