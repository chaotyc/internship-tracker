import { useEffect, useState } from 'react'
import { FITS, STAGES, type Role, type RoleInput, type StageKey } from '@shared/roles'
import { Dialog } from '@renderer/components/Dialog'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api } from '@renderer/lib/api'
import { hostOf } from '@renderer/lib/format'
import { AutofillButton } from '@renderer/features/autofill/AutofillButton'
import { Monogram } from './RoleCard'

type Form = Required<Pick<RoleInput, 'company' | 'title' | 'stage' | 'fit' | 'location' | 'pay' | 'deadline' | 'priority' | 'appliedOn' | 'link' | 'postingStatus' | 'why' | 'watch' | 'notes'>>

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
  const [filled, setFilled] = useState<Set<string>>(new Set())
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState<{ text: string; tone: '' | 'warn' | 'error' }>({ text: '', tone: '' })
  const [saving, setSaving] = useState(false)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(role ? pick(role) : { ...EMPTY, stage: initialStage })
    setFilled(new Set())
    setReadNote({ text: '', tone: '' })
    setArmed(false)
  }, [open, role, initialStage])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setFilled((s) => {
      if (!s.has(k)) return s
      const n = new Set(s)
      n.delete(k)
      return n
    })
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
      setReadNote({
        text: draft.warning || `Filled ${draft.filled.length} field${draft.filled.length === 1 ? '' : 's'} from the posting. Check them, then save.`,
        tone: draft.warning ? 'warn' : '',
      })
    } catch (e) {
      setReadNote({ text: (e as Error).message, tone: 'error' })
    } finally {
      setReading(false)
    }
  }

  const save = async () => {
    if (!form.company.trim() || !form.title.trim()) {
      toast('Add a company and a role title before saving.', { tone: 'error' })
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
      onClose()
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
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

  const cls = (k: keyof Form) => (filled.has(k) ? 'is-filled' : undefined)
  const linkOk = /^https?:\/\//.test(form.link.trim())

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={720}
      title={
        role ? (
          <span className="dlg-role-title">
            <Monogram name={role.company} size={30} />
            <span>
              {role.company}
              <small>{role.title}</small>
            </span>
          </span>
        ) : (
          'Add a role'
        )
      }
      subtitle={role ? undefined : 'Paste the posting link and the app reads the details for you.'}
      footer={
        <>
          {role && (
            <button type="button" className={`btn btn-danger${armed ? ' is-armed' : ''}`} onClick={remove}>
              <Icon name="trash" />
              {armed ? 'Click again to delete' : 'Delete'}
            </button>
          )}
          {role && (
            <button type="button" className="btn btn-ghost" onClick={() => onAskAssistant(role.id)}>
              <Icon name="chat" />
              Ask the assistant
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {role ? 'Save changes' : 'Add to board'}
          </button>
        </>
      }
    >
      <section className="link-row">
        <label className="field link-field">
          <span>Posting link</span>
          <div className="link-input">
            <Icon name="link" />
            <input
              value={form.link}
              placeholder="https://job-boards.greenhouse.io/…"
              onChange={(e) => set('link', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
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
        <button type="button" className="btn" onClick={readLink} disabled={reading || !form.link.trim()}>
          <Icon name="wand" />
          {reading ? 'Reading…' : role ? 'Refill from posting' : 'Fill in from link'}
        </button>
        {role && linkOk && <AutofillButton roleId={role.id} link={form.link} />}
      </section>
      {readNote.text && <p className={`read-note ${readNote.tone}`}>{readNote.text}</p>}

      <div className="grid-2">
        <label className="field">
          <span>Company</span>
          <input className={cls('company')} value={form.company} onChange={(e) => set('company', e.target.value)} />
        </label>
        <label className="field">
          <span>Role</span>
          <input className={cls('title')} value={form.title} onChange={(e) => set('title', e.target.value)} />
        </label>
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
          <span>Location</span>
          <input className={cls('location')} value={form.location} onChange={(e) => set('location', e.target.value)} />
        </label>
        <label className="field">
          <span>Pay</span>
          <input className={cls('pay')} value={form.pay} placeholder="$45–60/hr" onChange={(e) => set('pay', e.target.value)} />
        </label>
        <label className="field">
          <span>Deadline</span>
          <input className={cls('deadline')} type="date" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
        </label>
        <label className="field">
          <span>Applied on</span>
          <input type="date" value={form.appliedOn} onChange={(e) => set('appliedOn', e.target.value)} />
        </label>
        <label className="field">
          <span>Priority</span>
          <input value={form.priority} placeholder="e.g. This week" onChange={(e) => set('priority', e.target.value)} />
        </label>
        <label className="field">
          <span>Posting status</span>
          <input className={cls('postingStatus')} value={form.postingStatus} onChange={(e) => set('postingStatus', e.target.value)} />
        </label>
        <label className="field wide">
          <span>Why it fits</span>
          <textarea className={cls('why')} rows={2} value={form.why} onChange={(e) => set('why', e.target.value)} />
        </label>
        <label className="field wide">
          <span>Watch-outs</span>
          <textarea className={cls('watch')} rows={2} value={form.watch} onChange={(e) => set('watch', e.target.value)} />
        </label>
        <label className="field wide">
          <span>Notes</span>
          <textarea
            rows={3}
            value={form.notes}
            placeholder="Interview dates, recruiter name, next step"
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
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
