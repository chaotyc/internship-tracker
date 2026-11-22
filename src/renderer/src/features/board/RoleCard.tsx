import type { HTMLAttributes } from 'react'
import type { Role } from '@shared/roles'
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

function DeadlineChip({ deadline }: { deadline: string }) {
  const d = daysUntil(deadline)
  if (d == null) return null
  if (d < 0) return <span className="chip danger">Deadline passed</span>
  const tone = d <= 3 ? 'danger' : d <= 10 ? 'warn' : ''
  return (
    <span className={`chip ${tone}`} title={`Deadline ${shortDate(deadline)}`}>
      <Icon name="clock" />
      {d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : d <= 14 ? `Due in ${d}d` : `Due ${shortDate(deadline)}`}
    </span>
  )
}

export function RoleCard({ role, ghost, ...rest }: Props) {
  const meta = [role.location, role.pay].filter(Boolean).join(' · ')
  const live = role.liveness?.status
  const showApplied = role.appliedOn && role.stage !== 'saved' && role.stage !== 'closed'
  return (
    <article
      className={`card${ghost ? ' is-ghost' : ''}${live === 'closed' && role.stage === 'saved' ? ' is-stale' : ''}`}
      data-card={ghost ? undefined : role.id}
      tabIndex={ghost ? -1 : 0}
      aria-label={`${role.company}, ${role.title}`}
      {...rest}
    >
      <div className="card-top">
        <Monogram name={role.company} />
        <div className="card-heading">
          <div className="card-company">{role.company}</div>
          <div className="card-title">{role.title}</div>
        </div>
        <button type="button" className="card-grip" data-grip aria-hidden="true" tabIndex={-1}>
          <Icon name="grip" />
        </button>
      </div>
      {meta && <div className="card-meta">{meta}</div>}
      {(role.fit || role.deadline || showApplied || live === 'closed' || live === 'expiring' || role.source === 'autosearch') && (
        <div className="card-chips">
          {live === 'closed' && (
            <span className="chip danger" title={role.liveness.detail}>
              <Icon name="alert" />
              Posting closed
            </span>
          )}
          {live === 'expiring' && !role.deadline && (
            <span className="chip warn" title={role.liveness.detail}>
              <Icon name="clock" />
              Closing soon
            </span>
          )}
          {role.deadline && role.stage === 'saved' && <DeadlineChip deadline={role.deadline} />}
          {role.fit && <span className={`chip fit fit-${role.fit.toLowerCase()}`}>{role.fit} fit</span>}
          {showApplied && <span className="chip">Applied {ago(role.appliedOn)}</span>}
          {role.source === 'autosearch' && role.stage === 'saved' && (
            <span className="chip accent">
              <Icon name="sparkle" />
              Found for you
            </span>
          )}
        </div>
      )}
      {role.notes && <div className="card-note">{role.notes}</div>}
    </article>
  )
}
