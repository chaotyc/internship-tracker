import { useState } from 'react'
import type { Role } from '@shared/roles'
import type { EmailProposal } from '@shared/today'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { Monogram } from '@renderer/features/board/RoleCard'
import { dueLabel } from '@renderer/lib/format'
import { MailIcon, sinceLabel, stageLabel } from './parts'

/** One proposed update from an email: what it says, exactly what Update role will change, Update role / Dismiss. */
export function ProposalCard({ p, role, onOpenRole, onDone }: { p: EmailProposal; role: Role | null; onOpenRole: (id: string) => void; onDone: (id: string) => void }) {
  const toast = useToast()
  const stageChanges = !!p.stage && !!role && p.stage !== role.stage
  const hasStep = !!p.nextStep
  const both = stageChanges && hasStep
  const [useStage, setUseStage] = useState(true)
  const [useStep, setUseStep] = useState(true)
  const [busy, setBusy] = useState<'' | 'apply' | 'applied' | 'dismiss'>('')
  const current = role?.nextStep && !role.nextStep.done && role.nextStep.text ? role.nextStep : null

  const apply = async () => {
    setBusy('apply')
    try {
      await api.invoke('today:applyProposal', { id: p.id, stage: stageChanges && useStage, nextStep: hasStep && useStep })
      setBusy('applied')
      toast(`Updated ${p.company}.`, { tone: 'success' })
      // Let "Updated" show for a moment before the card goes away.
      setTimeout(() => onDone(p.id), 700)
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
      setBusy('')
    }
  }
  const dismiss = async () => {
    setBusy('dismiss')
    try {
      await api.invoke('today:dismissProposal', { id: p.id })
      onDone(p.id)
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
      setBusy('')
    }
  }

  const nothingLeft = !stageChanges && !hasStep
  const applyDisabled = !!busy || !role || nothingLeft || (both && !useStage && !useStep)
  const when = p.email.date ? sinceLabel(p.email.date) : sinceLabel(p.createdAt)

  return (
    <article className="td-prop" aria-label={`Proposed update for ${p.company}`}>
      <div className="td-prop-head">
        <Monogram name={p.company} size={30} />
        <div style={{ minWidth: 0 }}>
          <div className="td-prop-role">
            {p.company} <span>· {p.title}</span>
          </div>
          <div className="td-prop-from" title={`${p.email.from}\n${p.email.subject}`}>
            <MailIcon />
            <span>
              {p.email.subject ? `“${p.email.subject}”` : 'An email'} · {p.email.from.replace(/\s*<.*>$/, '')}
              {when ? ` · ${when}` : ''}
            </span>
          </div>
        </div>
        <span className={`chip${p.via === 'ai' ? ' accent' : ''}`} title={p.via === 'ai' ? 'Read by your AI connection' : 'Worked out from simple keyword rules'}>
          {p.via === 'ai' ? <Icon name="sparkle" /> : <Icon name="list" />}
          {p.via === 'ai' ? 'AI' : 'Rules'}
        </span>
      </div>
      <p className="td-prop-summary">{p.summary}</p>
      {(stageChanges || hasStep) && (
        <ul className="td-changes" aria-label="What Update role will change">
          {stageChanges && role && (
            <li className={`td-change${both && !useStage ? ' is-off' : ''}`}>
              <span className="td-change-label">
                {both && <input type="checkbox" checked={useStage} onChange={(e) => setUseStage(e.target.checked)} aria-label="Change the stage" />}
                Stage
              </span>
              <span className="td-change-value">
                <span className="td-from">{stageLabel(role.stage)}</span>
                <span className="td-arrow" aria-label="to">
                  →
                </span>
                <span className="td-to">{stageLabel(p.stage!)}</span>
              </span>
            </li>
          )}
          {hasStep && (
            <li className={`td-change${both && !useStep ? ' is-off' : ''}`}>
              <span className="td-change-label">
                {both && <input type="checkbox" checked={useStep} onChange={(e) => setUseStep(e.target.checked)} aria-label="Set the next step" />}
                Next step
              </span>
              <span className="td-change-value">
                <span className="td-to">{p.nextStep!.text}</span>
                {p.nextStep!.due ? ` · ${dueLabel(p.nextStep!.due, p.nextStep!.time)}` : ' · no date'}
                {current && <small>Replaces “{current.text}”</small>}
              </span>
            </li>
          )}
        </ul>
      )}
      {!role && <p className="td-prop-note">That role is no longer on your board.</p>}
      {role && nothingLeft && <p className="td-prop-note">The board already shows this. Dismiss it to clear it away.</p>}
      {p.note && (
        <p className="td-prop-note">
          <Icon name="alert" />
          {p.note}
        </p>
      )}
      <div className="td-prop-actions">
        <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={applyDisabled}>
          <Icon name="check" />
          {busy === 'apply' ? 'Updating…' : busy === 'applied' ? 'Updated' : 'Update role'}
        </button>
        <button type="button" className="btn" onClick={() => void dismiss()} disabled={!!busy}>
          {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
        </button>
        {role && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenRole(role.id)}>
            Open role
            <Icon name="arrowRight" />
          </button>
        )}
      </div>
    </article>
  )
}
