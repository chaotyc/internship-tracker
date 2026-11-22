import type { HTMLAttributes } from 'react'
import type { Fit, Role } from '@shared/roles'
import { Icon } from '@renderer/components/Icon'
import { ago, daysUntil, deadlineTone, dueLabel, hueFor, monogram, shortDate } from '@renderer/lib/format'

// Kept for features that import it from here.
export { dueLabel }

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

function DeadlineChip({ deadline }: { deadline: string }) {
  const d = daysUntil(deadline)
  if (d == null) return null
  if (d < 0) return <span className="chip danger">Deadline passed</span>
  const label = `Due ${dueLabel(deadline, '')}`
  // Only near deadlines get a color; distant ones are plain facts.
  const tone = deadlineTone(deadline)
  return (
    <span className={`chip card-due ${tone}`} title={`Deadline ${shortDate(deadline)}`}>
      <Icon name="flag" />
      {label}
    </span>
  )
}

/** True when a note mostly repeats the next step, so the card doesn't say it twice. */
function similar(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
  const wa = words(a)
  const wb = words(b)
  if (!wa.size || !wb.size) return false
  let shared = 0
  for (const w of wb) if (wa.has(w)) shared++
  return shared / wb.size >= 0.6
}

/** "3w", "13d", "1d", "today": the age without "Applied" or "ago", for narrow lanes. */
function shortAgo(iso: string): string {
  const a = ago(iso)
  return a === 'yesterday' ? '1d' : a.replace(/ ago$/, '')
}

function nextTone(due: string): string {
  const d = daysUntil(due)
  if (d == null) return ''
  return d < 0 ? ' is-overdue' : d === 0 ? ' is-today' : ''
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Today and overdue steps keep their own emphasised label line; future dates sit inline
 * ("Tue · Finish the application") so the block stays short.
 */
function NextStep({ step }: { step: NonNullable<Role['nextStep']> }) {
  const d = step.due ? daysUntil(step.due) : null
  const text = step.text || 'Next step'
  if (d != null && d > 0) {
    return (
      <div className="card-next is-inline">
        <span className="card-next-text">
          <span className="card-next-due">{capitalize(dueLabel(step.due, step.time))}</span>
          <span className="card-next-sep" aria-hidden="true">
            {' · '}
          </span>
          {text}
        </span>
      </div>
    )
  }
  return (
    <div className={`card-next${nextTone(step.due)}`}>
      <span className="card-next-due">{step.due ? dueLabel(step.due, step.time) : 'Next step'}</span>
      <span className="card-next-text">{text}</span>
    </div>
  )
}

export function RoleCard({ role, ghost, ...rest }: Props) {
  const meta = [role.location, role.pay].filter(Boolean)
  const live = role.liveness?.status
  const saved = role.stage === 'saved'
  const finished = role.stage === 'rejected' || role.stage === 'closed'
  // Deadlines matter in every open stage (offer and interview deadlines most of all).
  const showDeadline = !finished && !!role.deadline && !(saved && live === 'closed')
  const alerts = (saved && (live === 'closed' || live === 'expiring')) || showDeadline
  const showFit = !finished && !!role.fit
  const hasNext = !!role.nextStep && !role.nextStep.done && !finished
  return (
    <article
      className={`card${ghost ? ' is-ghost' : ''}${live === 'closed' && saved ? ' is-stale' : ''}${finished ? ' is-finished' : ''}`}
      data-card={ghost ? undefined : role.id}
      tabIndex={ghost ? -1 : 0}
      aria-label={`${role.company}, ${role.title}`}
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
      {hasNext && <NextStep step={role.nextStep!} />}
      {meta.length > 0 && (
        <div className="card-meta" title={meta.join(' · ')}>
          <div className="card-meta-inner">
            {meta.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </div>
      )}
      {alerts && (
        <div className="card-chips">
          {saved && live === 'closed' && (
            <span className="chip danger" title={role.liveness.detail}>
              <Icon name="alert" />
              Posting closed
            </span>
          )}
          {showDeadline && <DeadlineChip deadline={role.deadline} />}
          {saved && live === 'expiring' && !role.deadline && (
            <span className="chip warn" title={role.liveness.detail}>
              <Icon name="clock" />
              Closing soon
            </span>
          )}
        </div>
      )}
      {(showFit || role.appliedOn || (saved && role.source === 'autosearch')) && (
        <div className="card-foot">
          {showFit && <FitMeter fit={role.fit} />}
          {saved && role.source === 'autosearch' && (
            <span className="card-found" title="Found for you">
              <Icon name="sparkle" />
              <span className="card-foot-full">Found for you</span>
              <span className="card-foot-short">Found</span>
            </span>
          )}
          {!saved && role.appliedOn && role.stage !== 'closed' && (
            <span className="card-age" title={`Applied ${ago(role.appliedOn)}`}>
              <span className="card-foot-full">Applied {ago(role.appliedOn)}</span>
              <span className="card-foot-short">{shortAgo(role.appliedOn)}</span>
            </span>
          )}
        </div>
      )}
      {!finished && role.notes && !(hasNext && similar(role.notes, role.nextStep!.text)) && (
        <div className="card-note" title={role.notes}>
          <Icon name="note" />
          <span className="card-note-text">{role.notes}</span>
        </div>
      )}
    </article>
  )
}
