import { useEffect, useMemo, useRef, useState } from 'react'
import { FITS, STAGES, type NextStep, type Role, type RoleInput, type StageKey } from '@shared/roles'
import { normalizeLink } from '@shared/profile'
import { NextStepField } from '@renderer/features/today/NextStepField'
import { TrackSelect } from '@renderer/features/tracks/TrackSelect'
import { DateField } from '@renderer/components/DateField'
import { Dialog } from '@renderer/components/Dialog'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { hostOf } from '@renderer/lib/format'
import { AutofillButton } from '@renderer/features/autofill/AutofillButton'
import { Monogram } from './RoleCard'

type Form = Required<
  Pick<
    RoleInput,
    | 'company'
    | 'title'
    | 'stage'
    | 'fit'
    | 'location'
    | 'pay'
    | 'deadline'
    | 'priority'
    | 'appliedOn'
    | 'link'
    | 'postingStatus'
    | 'why'
    | 'watch'
    | 'notes'
    | 'trackId'
  >
> & { nextStep: NextStep | null }

const EMPTY: Form = {
  company: '',
  title: '',
  stage: 'saved',
  fit: '',
  location: '',
  pay: '',
  deadline: '',
  priority: '',
  appliedOn: '',
  link: '',
  postingStatus: '',
  why: '',
  watch: '',
  notes: '',
  trackId: '',
  nextStep: null,
}

const DETAIL_KEYS: (keyof Form)[] = ['why', 'watch', 'priority', 'postingStatus']
const MOD = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl+'

/** The link as a fetchable https URL ("boards.greenhouse.io/x" gains https://), or '' when it isn't a web link. */
function webLink(v: string): string {
  const n = normalizeLink(v)
  if (!n) return ''
  try {
    const u = new URL(n)
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? n : ''
  } catch {
    return ''
  }
}

interface Props {
  open: boolean
  role: Role | null
  initialStage: StageKey
  onClose: () => void
  onAskAssistant: (roleId: string) => void
}

export function RoleDialog({ open, role, initialStage, onClose, onAskAssistant }: Props) {
  const toast = useToast()
  const [form, setForm] = useState<Form>(EMPTY)
  const [initial, setInitial] = useState<Form>(EMPTY)
  const [filled, setFilled] = useState<Set<string>>(new Set())
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState<{ text: string; tone: '' | 'warn' | 'error' }>({ text: '', tone: '' })
  const [saving, setSaving] = useState(false)
  const [armed, setArmed] = useState(false)
  const [manual, setManual] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [errors, setErrors] = useState<{ company?: string; title?: string }>({})
  /** What the user tried to do with unsaved changes; the inline bar asks before doing it. */
  const [pendingLeave, setPendingLeave] = useState<null | 'close' | 'assistant' | 'settings'>(null)
  const [saveError, setSaveError] = useState('')
  const confirmClose = pendingLeave !== null
  /** Bumped whenever the dialog opens, closes or switches role, so a late posting read is dropped. */
  const sessionRef = useRef(0)
  /** Fields the user edited while a posting read was in flight; the read never overwrites them. */
  const editedRef = useRef<Set<string>>(new Set())
  const formRef = useRef(form)
  formRef.current = form

  useEffect(() => {
    sessionRef.current++
    editedRef.current = new Set()
    setReading(false)
    if (!open) return
    const start = role ? pick(role) : { ...EMPTY, stage: initialStage }
    setForm(start)
    setInitial(start)
    setFilled(new Set())
    setReadNote({ text: '', tone: '' })
    setArmed(false)
    setManual(!!role)
    setMoreOpen(!!role && DETAIL_KEYS.some((k) => !!role[k as keyof Role]))
    setErrors({})
    setPendingLeave(null)
    setSaveError('')
    // Keyed on the role's id, not the object: a background board refresh must not reset the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, role?.id, initialStage])

  const dirty = useMemo(
    () => (Object.keys(form) as (keyof Form)[]).some((k) => JSON.stringify(form[k]) !== JSON.stringify(initial[k])),
    [form, initial],
  )
  // In Add mode the form appears once the link has been read or the user chooses to type.
  const showForm = !!role || manual || filled.size > 0

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    editedRef.current.add(k)
    setPendingLeave(null)
    setSaveError('')
    if (k === 'company' || k === 'title') setErrors((e) => ({ ...e, [k]: undefined }))
    setFilled((s) => {
      if (!s.has(k)) return s
      const n = new Set(s)
      n.delete(k)
      return n
    })
  }

  const requestClose = () => {
    // Once the bar is showing, only an explicit Discard or Save leaves; Escape again does nothing.
    if (confirmClose) return
    if (dirty) {
      setPendingLeave('close')
      return
    }
    onClose()
  }
  const askAssistant = () => {
    if (!role) return
    if (dirty) {
      setPendingLeave('assistant')
      return
    }
    onAskAssistant(role.id)
  }
  // App closes this dialog and opens Settings on the Profile tab.
  const openProfileSettings = () => window.dispatchEvent(new CustomEvent('app:open-settings', { detail: 'profile' }))
  const askSettings = () => {
    if (dirty) {
      setPendingLeave('settings')
      return
    }
    openProfileSettings()
  }
  const leave = () => {
    const action = pendingLeave
    setPendingLeave(null)
    if (action === 'assistant' && role) onAskAssistant(role.id)
    else if (action === 'settings') openProfileSettings()
    else onClose()
  }

  const readLink = async () => {
    const url = webLink(form.link)
    if (!url) {
      setReadNote({ text: 'Paste the posting link, like boards.greenhouse.io/…', tone: 'error' })
      return
    }
    if (url !== form.link) setForm((f) => ({ ...f, link: url }))
    const session = sessionRef.current
    editedRef.current = new Set()
    // Only apply the result to the dialog, role and link that asked for it.
    const stillCurrent = () => sessionRef.current === session && webLink(formRef.current.link) === url
    setReading(true)
    setReadNote({ text: 'Reading the posting…', tone: '' })
    try {
      const draft = await api.invoke('search:fromLink', { url })
      if (!stillCurrent()) return
      const edited = editedRef.current
      const applied = draft.filled.filter((k) => !edited.has(k))
      setForm((f) => {
        const next = { ...f }
        for (const k of applied) {
          const v = (draft.role as Record<string, unknown>)[k]
          if (typeof v === 'string' && v && k in next) (next as unknown as Record<string, unknown>)[k] = v
        }
        return next
      })
      setFilled(new Set(applied))
      if (applied.some((k) => DETAIL_KEYS.includes(k as keyof Form))) setMoreOpen(true)
      setManual(true)
      setReadNote({
        text:
          draft.warning ||
          `Filled ${applied.length} field${applied.length === 1 ? '' : 's'} from the posting. Check them, then save.`,
        tone: draft.warning ? 'warn' : '',
      })
    } catch (e) {
      if (!stillCurrent()) return
      setReadNote({ text: (e as Error).message, tone: 'error' })
    } finally {
      if (sessionRef.current === session) setReading(false)
    }
  }

  const save = async () => {
    const errs: typeof errors = {}
    if (!form.company.trim()) errs.company = 'Add the company name.'
    if (!form.title.trim()) errs.title = 'Add the role title.'
    if (errs.company || errs.title) {
      setErrors(errs)
      setManual(true)
      requestAnimationFrame(() => document.getElementById(errs.company ? 'rd-company' : 'rd-title')?.focus())
      return
    }
    setSaving(true)
    try {
      const data = { ...form, link: webLink(form.link) || form.link.trim() }
      if (role) {
        await api.invoke('roles:update', { id: role.id, patch: data })
        toast(`Saved ${form.company}.`)
      } else {
        await api.invoke('roles:create', { ...data, source: 'manual' })
        toast(`Added ${form.company} to ${STAGES.find((s) => s.key === form.stage)?.label}.`)
      }
      if (pendingLeave === 'assistant' && role) onAskAssistant(role.id)
      else if (pendingLeave === 'settings') openProfileSettings()
      else onClose()
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!role) return
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 3500)
      return
    }
    try {
      await api.invoke('roles:delete', { id: role.id })
      onClose()
      toast(`Deleted ${role.company}.`)
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    }
  }

  const cls = (k: keyof Form) => [filled.has(k) ? 'is-filled' : '', errors[k as 'company'] ? 'is-invalid' : ''].join(' ').trim() || undefined
  const linkUrl = webLink(form.link)
  const linkOk = !!linkUrl
  const linkChanged = !!role && (linkUrl || form.link.trim()) !== (webLink(role.link) || role.link)
  // Autofill reads the saved role, so a changed link or track must be saved first.
  const trackChanged = !!role && form.trackId !== (role.trackId ?? '')
  // Autofill is the main action only while the role is Saved; later it's a quiet footer button, and gone once finished.
  const autofill =
    role && role.link && role.stage !== 'rejected' && role.stage !== 'closed' ? (
      <AutofillButton
        roleId={role.id}
        link={role.link}
        ghost={role.stage !== 'saved'}
        blockedReason={linkChanged || trackChanged ? 'Save changes to autofill with the new link/track' : undefined}
        onOpenSettings={askSettings}
      />
    ) : undefined

  // Editing opens on Progress (what changes most); adding stays link-first with Posting on top.
  const postingGroup = (
    <>
      {showForm && <h3 className="form-group">Posting</h3>}
      <section className={`link-row${showForm ? '' : ' is-start'}`}>
        <label className="field link-field">
          <span>Link</span>
          <div className="link-input">
            <Icon name="link" />
            <input
              value={form.link}
              placeholder="https://job-boards.greenhouse.io/…"
              onChange={(e) => set('link', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault()
                  void readLink()
                }
              }}
              data-autofocus={role ? undefined : true}
              spellCheck={false}
            />
            {linkOk && (
              <a className="icon-btn" href={linkUrl} target="_blank" rel="noreferrer" title={`Open on ${hostOf(linkUrl)}`}>
                <Icon name="external" />
              </a>
            )}
          </div>
        </label>
        <button
          type="button"
          className={`btn${role ? ' btn-ghost' : !showForm ? ' btn-primary' : ''}`}
          onClick={readLink}
          disabled={reading || !form.link.trim()}
        >
          <Icon name={role ? 'refresh' : 'wand'} />
          {reading ? 'Reading…' : role ? 'Re-read posting' : 'Fill in from link'}
        </button>
      </section>
      {readNote.text && (
        <p className={`read-note ${readNote.tone}`}>
          {readNote.text}
          {readNote.tone === 'error' && !showForm && (
            <>
              {' '}
              <button type="button" className="manual-link read-note-action" onClick={() => setManual(true)}>
                Enter details manually
              </button>
            </>
          )}
        </p>
      )}
      {linkChanged && role?.link !== undefined && linkOk && <p className="read-note">Save to use Autofill with the new link.</p>}
      {!showForm && (
        <button type="button" className="manual-link" onClick={() => setManual(true)}>
          No link? Enter the details yourself
        </button>
      )}
      {showForm && (
        <div className="grid-2">
          <label className="field">
            <span>
              Company<span className="req">*</span>
            </span>
            <input id="rd-company" className={cls('company')} value={form.company} onChange={(e) => set('company', e.target.value)} aria-invalid={!!errors.company} />
            {errors.company && <span className="field-error">{errors.company}</span>}
          </label>
          <label className="field">
            <span>
              Role<span className="req">*</span>
            </span>
            <input id="rd-title" className={cls('title')} value={form.title} onChange={(e) => set('title', e.target.value)} aria-invalid={!!errors.title} />
            {errors.title && <span className="field-error">{errors.title}</span>}
          </label>
          <label className="field">
            <span>Location</span>
            <input className={cls('location')} value={form.location} onChange={(e) => set('location', e.target.value)} />
          </label>
          <label className="field">
            <span>Pay</span>
            <input className={cls('pay')} value={form.pay} placeholder="$45–60/hr" onChange={(e) => set('pay', e.target.value)} />
          </label>
        </div>
      )}
    </>
  )
  const progressGroup = (
    <>
      <h3 className="form-group">Progress</h3>
      <div className="grid-2">
        <label className="field">
          <span>Stage</span>
          {/* Same stage dot as the board, beside the selected value. */}
          <div className="select-adorn" style={{ ['--stage' as string]: `var(--stage-${form.stage})` }}>
            <span className="adorn-dot" aria-hidden="true" />
            <select value={form.stage} onChange={(e) => set('stage', e.target.value as StageKey)}>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </label>
        <label className="field">
          <span>Job fit</span>
          {/* Same four-bar meter as the cards, beside the selected value. */}
          <div className={`select-adorn${form.fit ? '' : ' is-bare'}`}>
            {form.fit && (
              <span className="adorn-meter fit-bars" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <i key={i} className={i <= ({ Strong: 4, Good: 3, Moderate: 2, Weak: 1 } as const)[form.fit as 'Strong'] ? 'on' : ''} />
                ))}
              </span>
            )}
            <select className={cls('fit')} value={form.fit} onChange={(e) => set('fit', e.target.value as Form['fit'])}>
              <option value="">Not rated</option>
              {FITS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
        </label>
        <div className="wide track-row">
          <TrackSelect
            value={form.trackId}
            onChange={(id) => set('trackId', id)}
            note={trackChanged && role?.link ? 'Save to use this track for autofill.' : undefined}
          />
        </div>
        <DateField id="rd-deadline" label="Deadline" className={cls('deadline')} value={form.deadline} onChange={(v) => set('deadline', v)} />
        <DateField id="rd-applied" label="Applied on" value={form.appliedOn} onChange={(v) => set('appliedOn', v)} placeholder="Not yet" />
        <NextStepField value={form.nextStep} onChange={(v) => set('nextStep', v)} />
        <label className="field wide">
          <span>Notes</span>
          <textarea
            rows={2}
            value={form.notes}
            placeholder="Recruiter name, referral, interview prep"
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </div>
    </>
  )

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      width={680}
      title={
        role ? (
          <span className="dlg-role-title">
            <Monogram name={role.company} size={32} />
            <span>
              {role.company}
              <small>{role.title}</small>
            </span>
          </span>
        ) : (
          'Add a role'
        )
      }
      subtitle={role ? undefined : 'Paste the posting link and the details fill in for you.'}
      headerExtra={role?.stage === 'saved' ? autofill : undefined}
      footer={
        !showForm && !confirmClose ? undefined : confirmClose ? (
          <div className="discard-bar" role="alert">
            <span>{pendingLeave === 'assistant'
                ? 'Save your changes before asking the assistant?'
                : pendingLeave === 'settings'
                  ? 'Save your changes before opening Settings?'
                  : 'You have unsaved changes.'}</span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setPendingLeave(null)}>
              Keep editing
            </button>
            <button type="button" className="btn btn-danger" onClick={leave}>
              Discard
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              Save
            </button>
          </div>
        ) : (
          <>
            {role && (
              <button type="button" className={`btn btn-danger${armed ? ' is-armed' : ''}`} onClick={remove}>
                <Icon name="trash" />
                {armed ? 'Click again to delete' : 'Delete'}
              </button>
            )}
            {role && <span className="foot-divider" aria-hidden="true" />}
            {role && (
              <button type="button" className="btn btn-ghost" onClick={askAssistant} title="Ask the assistant">
                <Icon name="chat" />
                <span className="foot-label">Ask the assistant</span>
              </button>
            )}
            {role && role.stage !== 'saved' && autofill}
            <span className="spacer" />
            {saveError ? (
              <span className="foot-error" role="alert">
                {saveError}
              </span>
            ) : (
              // Hidden while Delete is armed, so its wider label never pushes Save out.
              showForm && dirty && !armed && <span className="foot-hint">{MOD}Enter to save</span>
            )}
            <button type="button" className="btn" onClick={requestClose}>
              Cancel
            </button>
            {showForm && (
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving || (!!role && !dirty)}>
                {role ? 'Save changes' : 'Add to board'}
              </button>
            )}
          </>
        )
      }
    >
      <div
        className="role-form"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && showForm) {
            e.preventDefault()
            void save()
          }
        }}
      >
        {role ? (
          <>
            {progressGroup}
            {postingGroup}
          </>
        ) : (
          <>
            {postingGroup}
            {showForm && progressGroup}
          </>
        )}

        {showForm && (
          <>
            <details className="more" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
              <summary>
                <Icon name="chevronDown" />
                More details
                <small>Why it fits, watch-outs, priority, posting status</small>
              </summary>
              <div className="grid-2">
                <label className="field wide">
                  <span>Why it fits</span>
                  <textarea className={cls('why')} rows={2} value={form.why} onChange={(e) => set('why', e.target.value)} />
                </label>
                <label className="field wide">
                  <span>Watch-outs</span>
                  <textarea className={cls('watch')} rows={2} value={form.watch} onChange={(e) => set('watch', e.target.value)} />
                </label>
                <label className="field">
                  <span>Priority</span>
                  <input value={form.priority} placeholder="e.g. This week" onChange={(e) => set('priority', e.target.value)} />
                </label>
                <label className="field">
                  <span>Posting status</span>
                  <input className={cls('postingStatus')} value={form.postingStatus} onChange={(e) => set('postingStatus', e.target.value)} />
                </label>
              </div>
            </details>
          </>
        )}
      </div>
    </Dialog>
  )
}

function pick(r: Role): Form {
  return {
    company: r.company,
    title: r.title,
    stage: r.stage,
    fit: r.fit,
    location: r.location,
    pay: r.pay,
    deadline: r.deadline,
    priority: r.priority,
    appliedOn: r.appliedOn,
    link: r.link,
    postingStatus: r.postingStatus,
    why: r.why,
    watch: r.watch,
    notes: r.notes,
    trackId: r.trackId ?? '',
    nextStep: r.nextStep ?? null,
  }
}
