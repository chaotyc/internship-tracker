import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ONBOARDING_STEPS, type OnboardingStep } from '@shared/onboarding'
import { Dialog } from '@renderer/components/Dialog'
import { Icon, type IconName } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import { plural } from '@renderer/lib/format'
import { AiStep } from './AiStep'
import { ProfileStep, type ProfileStepActions } from './ProfileStep'
import './onboarding.css'

const MOD = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl+'

const COPY: Record<OnboardingStep, { title: string; subtitle: string }> = {
  welcome: { title: 'Welcome to Internship Tracker', subtitle: 'A few quick steps to get set up. Each one is optional.' },
  ai: {
    title: 'Connect an AI provider',
    subtitle: 'Optional. Without AI, Find roles ranks by keywords and email updates use simple rules. The assistant needs AI.',
  },
  profile: { title: 'Your profile', subtitle: 'Autofill and Find roles use it. Add what you have now; the rest is in Settings, under Profile.' },
  roles: { title: 'Add your first roles', subtitle: 'Start with one. You can do the others any time.' },
  done: { title: 'A quick tour', subtitle: 'Where things are, so you can find them later.' },
}

export interface CsvResult {
  ok: boolean
  text: string
}

interface Props {
  open: boolean
  step: OnboardingStep
  onStep: (step: OnboardingStep) => void
  /** Finished from the last step, or closed early (Esc, the close button, Skip tour). */
  onClose: (outcome: 'completed' | 'skipped') => void
  roleCount: number
  /** Opens the Add role dialog; the tour comes back when it closes. */
  onAddRole: () => void
  /** Opens Settings at Job boards; the tour comes back when it closes. */
  onWatchCompanies: () => void
  onImportCsv: (file: File) => Promise<CsvResult>
}

/** The first-run welcome tour: a short, skippable dialog in five steps. */
export function Onboarding({ open, step, onStep, onClose, roleCount, onAddRole, onWatchCompanies, onImportCsv }: Props) {
  const index = ONBOARDING_STEPS.indexOf(step)
  const last = index === ONBOARDING_STEPS.length - 1
  const [canStoreKeys, setCanStoreKeys] = useState(true)
  const [busy, setBusy] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const profileRef = useRef<ProfileStepActions>(null)
  const shownStep = useRef<OnboardingStep | null>(null)

  useEffect(() => {
    if (!open) return
    api
      .invoke('onboarding:status')
      .then((s) => setCanStoreKeys(s.canStoreKeys))
      .catch(() => {})
  }, [open])

  // Moving between steps puts focus on the new step, so screen readers announce its title.
  useEffect(() => {
    if (!open) {
      shownStep.current = null
      return
    }
    if (shownStep.current && shownStep.current !== step) sectionRef.current?.focus()
    shownStep.current = step
  }, [open, step])

  const go = (delta: number) => {
    const next = ONBOARDING_STEPS[index + delta]
    if (next) onStep(next)
  }
  const next = async () => {
    if (busy) return
    if (last) return onClose('completed')
    if (step === 'profile' && profileRef.current) {
      // Unsaved contact details are saved on the way out; invalid ones keep the step open.
      setBusy(true)
      const ok = await profileRef.current.save()
      setBusy(false)
      if (!ok) return
    }
    go(1)
  }

  const { title, subtitle } = COPY[step]
  const footer = (
    <>
      {!last && (
        <button type="button" className="btn btn-ghost onb-skip" onClick={() => onClose('skipped')}>
          Skip tour
        </button>
      )}
      <span className="spacer" />
      <span className="onb-progress">
        <span className="onb-dots" aria-hidden="true">
          {ONBOARDING_STEPS.map((s, i) => (
            <i key={s} className={i === index ? 'is-on' : i < index ? 'is-done' : undefined} />
          ))}
        </span>
        <span className="onb-count tabular">
          Step {index + 1} of {ONBOARDING_STEPS.length}
        </span>
      </span>
      {index > 0 && (
        <button type="button" className="btn" onClick={() => go(-1)} disabled={busy}>
          Back
        </button>
      )}
      <button type="button" className="btn btn-primary" onClick={() => void next()} disabled={busy} data-autofocus>
        {last ? 'Finish' : busy ? 'Saving…' : step === 'welcome' ? 'Get started' : 'Next'}
        {!last && !busy && <Icon name="arrowRight" />}
      </button>
    </>
  )

  return (
    <Dialog open={open} onClose={() => onClose(last ? 'completed' : 'skipped')} title={title} subtitle={subtitle} width={600} footer={footer} className="onb">
      <section
        ref={sectionRef}
        key={step}
        className="onb-step"
        data-step={step}
        tabIndex={-1}
        aria-label={`${title}, step ${index + 1} of ${ONBOARDING_STEPS.length}`}
      >
        {step === 'welcome' && <WelcomeStep />}
        {step === 'ai' && <AiStep canStoreKeys={canStoreKeys} />}
        {step === 'profile' && <ProfileStep actions={profileRef} encrypted={canStoreKeys} />}
        {step === 'roles' && <RolesStep roleCount={roleCount} onAddRole={onAddRole} onWatchCompanies={onWatchCompanies} onImportCsv={onImportCsv} />}
        {step === 'done' && <DoneStep />}
      </section>
    </Dialog>
  )
}

function Point({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <li className="onb-point">
      <span className="onb-point-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{children}</small>
      </span>
    </li>
  )
}

function WelcomeStep() {
  return (
    <>
      <p className="onb-lead">Track every internship and job application, from first look to offer. See what’s due today, find new roles that fit you and fill in applications from your profile.</p>
      <ul className="onb-points">
        <Point icon="lock" title="Your data stays on this computer">
          No account and no cloud copy. You can export or erase everything in Settings.
        </Point>
        <Point icon="sparkle" title="AI is optional">
          Use a provider you already have. Only what a feature needs is sent, and only to that provider.
        </Point>
        <Point icon="check" title="You stay in control">
          Changes are proposals you confirm. Autofill never submits an application.
        </Point>
      </ul>
    </>
  )
}

function RolesStep({ roleCount, onAddRole, onWatchCompanies, onImportCsv }: Omit<Props, 'open' | 'step' | 'onStep' | 'onClose'>) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState<CsvResult | 'running' | null>(null)
  return (
    <>
      <div className="empty-steps">
        <button type="button" className="empty-step is-primary" onClick={onAddRole}>
          <span className="empty-icon">
            <Icon name="link" />
          </span>
          <span>
            <strong>Paste a job link</strong>
            <small>The app reads the posting and fills in the details</small>
          </span>
          <Icon name="arrowRight" className="empty-arrow" />
        </button>
        <button type="button" className="empty-step" onClick={() => fileRef.current?.click()} disabled={csv === 'running'}>
          <span className="empty-icon">
            <Icon name="upload" />
          </span>
          <span>
            <strong>{csv === 'running' ? 'Importing…' : 'Import a spreadsheet'}</strong>
            <small>Any CSV with Company and Role columns</small>
          </span>
          <Icon name="arrowRight" className="empty-arrow" />
        </button>
        <button type="button" className="empty-step" onClick={onWatchCompanies}>
          <span className="empty-icon">
            <Icon name="list" />
          </span>
          <span>
            <strong>Choose companies to watch</strong>
            <small>Find roles checks their job boards for new postings</small>
          </span>
          <Icon name="arrowRight" className="empty-arrow" />
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setCsv('running')
          void onImportCsv(f).then(setCsv)
        }}
      />
      <div className="onb-result-slot" role="status">
        {csv && csv !== 'running' ? (
          <p className={`onb-result ${csv.ok ? 'is-ok' : 'is-err'}`}>
            <Icon name={csv.ok ? 'check' : 'alert'} />
            <span>{csv.text}</span>
          </p>
        ) : roleCount > 0 ? (
          <p className="onb-result is-ok">
            <Icon name="check" />
            <span>{plural(roleCount, 'role')} on your board.</span>
          </p>
        ) : null}
      </div>
    </>
  )
}

function DoneStep() {
  return (
    <>
      <ul className="onb-points">
        <Point icon="board" title="Board">
          Move roles from Saved to Offer. Drag a card, or press Shift and an arrow key.
        </Point>
        <Point icon="sun" title="Today">
          Next steps, deadlines and email updates in one list.
        </Point>
        <Point icon="sparkle" title="Find roles">
          Checks the job boards you watch and ranks new postings for you.
        </Point>
        <Point icon="chat" title="Assistant">
          Ask about your board or draft answers. Open it with {MOD}J.
        </Point>
        <Point icon="wand" title="Autofill">
          Fills Greenhouse, Ashby and Lever forms from your profile. It never submits; you review and click Submit yourself.
        </Point>
      </ul>
      <p className="onb-foot-note">You can open this tour again from Settings.</p>
    </>
  )
}
