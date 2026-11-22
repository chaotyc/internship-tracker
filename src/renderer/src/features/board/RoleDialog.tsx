import { useEffect, useMemo, useState } from 'react'
import { FITS, STAGES, type Role, type RoleInput, type StageKey } from '@shared/roles'
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
    'company' | 'title' | 'stage' | 'fit' | 'location' | 'pay' | 'deadline' | 'priority' | 'appliedOn' | 'link' | 'postingStatus' | 'why' | 'watch' | 'notes'
  >
>

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
}

const DETAIL_KEYS: (keyof Form)[] = ['why', 'watch', 'priority', 'postingStatus']
const MOD = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl+'

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
  const [pendingLeave, setPendingLeave] = useState<null | 'close' | 'assistant'>(null)
  const [saveError, setSaveError] = useState('')
  const confirmClose = pendingLeave !== null

  useEffect(() => {
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

  const dirty = useMemo(() => (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== initial[k]), [form, initial])
  // In Add mode the form appears once the link has been read or the user chooses to type.
  const showForm = !!role || manual || filled.size > 0

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
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
  const leave = () => {
    const action = pendingLeave
    setPendingLeave(null)
    if (action === 'assistant' && role) onAskAssistant(role.id)
    else onClose()
  }

  const readLink = async () => {
    const url = form.link.trim()
    if (!/^https?:\/\//.test(url)) {
      setReadNote({ text: 'Paste a full link that starts with https://', tone: 'error' })
      return
    }
    setReading(true)
    setReadNote({ text: 'Reading the posting…', tone: '' })
    try {
      const draft = await api.invoke('search:fromLink', { url })
      setForm((f) => {
        const next = { ...f }
        for (const k of draft.filled) {
          const v = (draft.role as Record<string, unknown>)[k]
          if (typeof v === 'string' && v && k in next) (next as Record<string, string>)[k] = v
        }
        return next
      })
      setFilled(new Set(draft.filled))
      if (draft.filled.some((k) => DETAIL_KEYS.includes(k as keyof Form))) setMoreOpen(true)
      setManual(true)
      setReadNote({
        text:
          draft.warning ||
          `Filled ${draft.filled.length} field${draft.filled.length === 1 ? '' : 's'} from the posting. Check them, then save.`,
        tone: draft.warning ? 'warn' : '',
      })
    } catch (e) {
      setReadNote({ text: (e as Error).message, tone: 'error' })
    } finally {
      setReading(false)
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
      if (role) {
        await api.invoke('roles:update', { id: role.id, patch: form })
        toast(`Saved ${form.company}.`)
      } else {
        await api.invoke('roles:create', { ...form, source: 'manual' })
        toast(`Added ${form.company} to ${STAGES.find((s) => s.key === form.stage)?.label}.`)
      }
      if (pendingLeave === 'assistant' && role) onAskAssistant(role.id)
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
  const linkOk = /^https?:\/\//.test(form.link.trim())
  const linkChanged = !!role && form.link.trim() !== role.link

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
      headerExtra={role && role.link && !linkChanged ? <AutofillButton roleId={role.id} link={role.link} /> : undefined}
      footer={
        !showForm && !confirmClose ? undefined : confirmClose ? (
          <div className="discard-bar" role="alert">
            <span>{pendingLeave === 'assistant' ? 'Save your changes before asking the assistant?' : 'You have unsaved changes.'}</span>
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
            {role && (
              <button type="button" className="btn btn-ghost" onClick={askAssistant}>
                <Icon name="chat" />
                Ask the assistant
              </button>
            )}
            <span className="spacer" />
            {saveError ? (
              <span className="foot-error" role="alert">
                {saveError}
              </span>
            ) : (
              showForm && <span className="foot-hint">{MOD}Enter to save</span>
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
        <section className={`link-row${showForm ? '' : ' is-start'}`}>
          <label className="field link-field">
            <span>Posting link</span>
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
                <a className="icon-btn" href={form.link} target="_blank" rel="noreferrer" title={`Open on ${hostOf(form.link)}`}>
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
        {readNote.text && <p className={`read-note ${readNote.tone}`}>{readNote.text}</p>}
        {linkChanged && role?.link !== undefined && linkOk && <p className="read-note">Save to use Autofill with the new link.</p>}
        {!showForm && (
          <button type="button" className="manual-link" onClick={() => setManual(true)}>
            No link? Enter the details yourself
          </button>
        )}

        {showForm && (
          <>
            <div className="grid-2">
              <h3 className="form-group wide">Posting</h3>
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
              <h3 className="form-group wide">Progress</h3>
              <label className="field">
                <span>Stage</span>
                <select value={form.stage} onChange={(e) => set('stage', e.target.value as StageKey)}>
                  {STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Job fit</span>
                <select className={cls('fit')} value={form.fit} onChange={(e) => set('fit', e.target.value as Form['fit'])}>
                  <option value="">Not rated</option>
                  {FITS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Deadline</span>
                <input className={[cls('deadline'), form.deadline ? '' : 'is-empty'].filter(Boolean).join(' ')} type="date" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
              </label>
              <label className="field">
                <span>Applied on</span>
                <input className={form.appliedOn ? undefined : 'is-empty'} type="date" value={form.appliedOn} onChange={(e) => set('appliedOn', e.target.value)} />
              </label>
              <label className="field wide">
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={form.notes}
                  placeholder="Next step, interview times, recruiter name"
                  onChange={(e) => set('notes', e.target.value)}
                />
              </label>
            </div>

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
  }
}
