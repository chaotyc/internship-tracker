import type { HTMLAttributes } from 'react'
import type { Fit, Role } from '@shared/roles'
import { Icon } from '@renderer/components/Icon'
import { ago, daysUntil, hueFor, monogram, shortDate } from '@renderer/lib/format'

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
  const label = d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : d <= 14 ? `Due in ${d} days` : `Due ${shortDate(deadline)}`
  // Only near deadlines get a color; distant ones are plain facts.
  const tone = d <= 3 ? 'danger' : d <= 10 ? 'warn' : ''
  return (
    <span className={`chip ${tone}`} title={`Deadline ${shortDate(deadline)}`}>
      <Icon name="clock" />
      {label}
    </span>
  )
}

export function RoleCard({ role, ghost, ...rest }: Props) {
  const meta = [role.location, role.pay].filter(Boolean).join(' · ')
  const live = role.liveness?.status
  const saved = role.stage === 'saved'
  const active = role.stage === 'interviewing' || role.stage === 'offer'
  const finished = role.stage === 'rejected' || role.stage === 'closed'
  // Deadlines matter in every open stage (offer and interview deadlines most of all).
  const alerts = (saved && (live === 'closed' || live === 'expiring')) || (!finished && !!role.deadline)
  const showFit = !finished && !!role.fit
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
          <div className="card-title">{role.title}</div>
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
      {active && role.notes && (
        <div className="card-next">
          <Icon name="arrowRight" />
          <span>{role.notes}</span>
        </div>
      )}
      {meta && <div className="card-meta">{meta}</div>}
      {alerts && (
        <div className="card-chips">
          {saved && live === 'closed' && (
            <span className="chip danger" title={role.liveness.detail}>
              <Icon name="alert" />
              Posting closed
            </span>
          )}
          {saved && live === 'expiring' && !role.deadline && (
            <span className="chip warn" title={role.liveness.detail}>
              <Icon name="clock" />
              Closing soon
            </span>
          )}
          {role.deadline && !(saved && live === 'closed') && <DeadlineChip deadline={role.deadline} />}
        </div>
      )}
      {(showFit || role.appliedOn || (saved && role.source === 'autosearch')) && (
        <div className="card-foot">
          {showFit && <FitMeter fit={role.fit} />}
          {saved && role.source === 'autosearch' && (
            <span className="card-found">
              <Icon name="sparkle" />
              Found for you
            </span>
          )}
          {!saved && role.appliedOn && role.stage !== 'closed' && <span className="card-age">Applied {ago(role.appliedOn)}</span>}
        </div>
      )}
      {!active && !finished && role.notes && <div className="card-note">{role.notes}</div>}
    </article>
  )
}
