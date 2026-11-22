import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { Icon } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import {
  displayName,
  EMPTY_EDUCATION,
  EMPTY_PROFILE,
  RESUME_EXTENSIONS,
  RESUME_MAX_BYTES,
  validateProfile,
  type Demographics,
  type Education,
  type Profile,
  type ProfileStatus,
  type ResumeImport,
  type SavedAnswer,
  type SearchPreferences,
} from '@shared/profile'
import './profile.css'

// ---------------------------------------------------------------------------
// Small pieces

function Section({ id, title, hint, aside, children }: { id: string; title: string; hint?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section pf-section" aria-labelledby={`pf-${id}`}>
      <div className="pf-section-head">
        <div>
          <h3 id={`pf-${id}`}>{title}</h3>
          {hint && <p className="pf-hint">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  onBlur?: () => void
  hint?: ReactNode
  placeholder?: string
  type?: 'text' | 'email' | 'tel' | 'url' | 'month'
  wide?: boolean
  autoComplete?: string
  inputMode?: 'text' | 'decimal' | 'email' | 'tel' | 'url'
  autoFocus?: boolean
  list?: string
  disabled?: boolean
}

function TextField({ label, value, onChange, error, onBlur, hint, wide, ...rest }: FieldProps) {
  const id = useId()
  return (
    <div className={`field${wide ? ' wide' : ''}${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-d` : undefined}
        spellCheck={rest.type === 'text' || !rest.type ? undefined : false}
        {...rest}
      />
      {error ? (
        <small id={`${id}-d`} className="pf-error">
          <Icon name="alert" />
          {error}
        </small>
      ) : hint ? (
        <small id={`${id}-d`} className="hint">
          {hint}
        </small>
      ) : null}
    </div>
  )
}

const TRI: { label: string; value: boolean | null }[] = [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
  { label: 'Not set', value: null },
]

function Segmented({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  const id = useId()
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TRI.findIndex((o) => o.value === value)
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = TRI[(i + d + TRI.length) % TRI.length]!
    onChange(next.value)
    const btns = e.currentTarget.querySelectorAll<HTMLButtonElement>('button')
    btns[TRI.indexOf(next)]?.focus()
  }
  return (
    <div className="pf-tri">
      <div className="pf-tri-text">
        <span id={id}>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="pf-segmented" role="radiogroup" aria-labelledby={id} onKeyDown={move}>
        {TRI.map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            tabIndex={value === o.value ? 0 : -1}
            className={value === o.value ? 'is-on' : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ChipInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
  tone,
}: {
  label: string
  hint?: string
  values: string[]
  onChange: (v: string[]) => void
  placeholder: string
  tone?: 'muted'
}) {
  const id = useId()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const commit = (raw: string) => {
    const seen = new Set(values.map((v) => v.toLowerCase()))
    const add: string[] = []
    for (const part of raw.split(/[,\n]/)) {
      const t = part.trim()
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase())
        add.push(t)
      }
    }
    if (add.length) onChange([...values, ...add])
    setText('')
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`pf-chips${tone === 'muted' ? ' is-muted' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), inputRef.current?.focus())}>
        {values.map((v, i) => (
          <span key={v} className="pf-chip">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((_, j) => j !== i))}>
              <Icon name="close" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={text}
          placeholder={values.length ? 'Add another' : placeholder}
          aria-describedby={hint ? `${id}-d` : undefined}
          onChange={(e) => {
            if (/[,\n]/.test(e.target.value)) commit(e.target.value)
            else setText(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault()
              commit(text)
            } else if (e.key === 'Backspace' && !text && values.length) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => text.trim() && commit(text)}
        />
      </div>
      {hint && (
        <small id={`${id}-d`} className="hint">
          {hint}
        </small>
      )}
    </div>
  )
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="pf-switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="pf-switch-track" aria-hidden="true" />
      <span className="pf-switch-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

export function Note({ tone, children }: { tone: 'warn' | 'info' | 'danger'; children: ReactNode }) {
  return (
    <div className={`pf-note pf-note-${tone}`} role={tone === 'info' ? undefined : 'status'}>
      {tone === 'info' ? <Icon name="lock" /> : <Icon name="alert" />}
      <div>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Demographics options. Values match the wording US application forms use.

type Opt = [value: string, label: string]
const DEMOGRAPHIC_FIELDS: { key: Exclude<keyof Demographics, 'pronouns'>; label: string; options: Opt[] }[] = [
  { key: 'gender', label: 'Gender', options: [['Female', 'Female'], ['Male', 'Male'], ['Non-binary', 'Non-binary']] },
  { key: 'hispanicLatino', label: 'Hispanic or Latino', options: [['Yes', 'Yes'], ['No', 'No']] },
  {
    key: 'race',
    label: 'Race',
    options: [
      ['American Indian or Alaska Native', 'American Indian or Alaska Native'],
      ['Asian', 'Asian'],
      ['Black or African American', 'Black or African American'],
      ['Native Hawaiian or Other Pacific Islander', 'Native Hawaiian or Other Pacific Islander'],
      ['White', 'White'],
      ['Two or More Races', 'Two or more races'],
    ],
  },
  {
    key: 'veteran',
    label: 'Veteran status',
    options: [
      ['I am not a protected veteran', 'Not a protected veteran'],
      ['I identify as one or more of the classifications of protected veteran', 'Protected veteran'],
    ],
  },
  {
    key: 'disability',
    label: 'Disability',
    options: [
      ['Yes, I have a disability (or previously had a disability)', 'Yes, I have (or had) a disability'],
      ['No, I do not have a disability and have not had one in the past', 'No disability'],
    ],
  },
]
const PRONOUNS = ['she/her', 'he/him', 'they/them']

function ChoiceSelect({ label, value, options, onChange, disabled }: { label: string; value: string; options: Opt[]; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId()
  const known = value === '' || value === 'decline' || options.some(([v]) => v === value)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={value ? undefined : 'is-unset'}>
        <option value="">Not set</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
        {!known && <option value={value}>{value}</option>}
        <option value="decline">Decline to answer</option>
      </select>
    </div>
  )
}

function PronounsField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId()
  const isKnown = value === '' || value === 'decline' || PRONOUNS.includes(value)
  const [custom, setCustom] = useState(!isKnown)
  const selectValue = custom ? 'custom' : value
  return (
    <div className="field">
      <label htmlFor={id}>Pronouns</label>
      <div className="pf-pronouns">
        <select
          id={id}
          value={selectValue}
          disabled={disabled}
          className={selectValue ? undefined : 'is-unset'}
          onChange={(e) => {
            const v = e.target.value
            setCustom(v === 'custom')
            onChange(v === 'custom' ? '' : v)
          }}
        >
          <option value="">Not set</option>
          {PRONOUNS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="custom">Something else…</option>
          <option value="decline">Decline to answer</option>
        </select>
        {custom && (
          <input aria-label="Your pronouns" placeholder="e.g. xe/xem" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} autoFocus />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resume

export function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export function fullDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function ResumeSection({
  resume,
  defaultTrack,
  onImported,
  onRemoved,
}: {
  resume: Profile['resume']
  /** Name of the default application track, when the user has tracks. */
  defaultTrack?: string
  onImported: (r: ResumeImport) => void
  onRemoved: (p: Profile) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [showText, setShowText] = useState(false)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(t)
  }, [armed])

  const run = async (fn: () => Promise<ResumeImport | null>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fn()
      if (res) onImported(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const choose = () => run(() => api.invoke('profile:importResume'))
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!(RESUME_EXTENSIONS as readonly string[]).includes(ext)) return setError('Drop a PDF, Word (.docx), text or Markdown file.')
    if (file.size > RESUME_MAX_BYTES) return setError('That file is over 15 MB. Resumes are usually well under 1 MB.')
    void run(async () => api.invoke('profile:importResumeData', { fileName: file.name, data: new Uint8Array(await file.arrayBuffer()) }))
  }
  const dragProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      if (!over) setOver(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
    },
    onDrop,
  }
  const remove = async () => {
    if (!armed) return setArmed(true)
    setArmed(false)
    setBusy(true)
    try {
      onRemoved(await api.invoke('profile:removeResume'))
      setShowText(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      id="resume"
      title="Resume"
      hint={
        defaultTrack
          ? `This is your default track’s resume (“${defaultTrack}”). Each application track keeps its own; manage them under Application tracks.`
          : 'Autofill attaches this file, and the assistant reads its text to judge fit and draft answers. The app keeps its own copy.'
      }
    >
      {resume ? (
        <div className={`pf-resume${over ? ' is-over' : ''}`} {...dragProps} aria-busy={busy}>
          <div className="pf-resume-row">
            <span className="pf-file-icon" aria-hidden="true">
              <Icon name="file" />
              <b>{resume.fileName.split('.').pop()?.toUpperCase()}</b>
            </span>
            <div className="pf-resume-meta">
              <strong title={resume.fileName}>{resume.fileName}</strong>
              <span>
                Updated {fullDate(resume.updatedAt)}
                {resume.text ? ` · ${words(resume.text).toLocaleString()} words read` : ' · no text found'}
              </span>
            </div>
            <div className="pf-resume-actions">
              <button type="button" className="btn btn-sm" onClick={choose} disabled={busy}>
                <Icon name="upload" />
                {busy ? 'Reading…' : 'Replace'}
              </button>
              <button
                type="button"
                className={`btn btn-sm btn-ghost btn-danger${armed ? ' is-armed' : ''}`}
                onClick={remove}
                disabled={busy}
                aria-label={armed ? 'Confirm: remove resume' : 'Remove resume'}
              >
                <Icon name="trash" />
                {armed ? 'Remove file?' : 'Remove'}
              </button>
            </div>
          </div>
          {resume.text ? (
            <>
              <button type="button" className="pf-disclosure" aria-expanded={showText} onClick={() => setShowText((s) => !s)}>
                <Icon name="chevronDown" />
                {showText ? 'Hide extracted text' : 'Show extracted text'}
              </button>
              {showText && (
                <pre className="pf-resume-text" tabIndex={0} aria-label="Text read from your resume">
                  {resume.text}
                </pre>
              )}
            </>
          ) : (
            <Note tone="warn">
              <strong>No text found; it may be a scanned image.</strong> Autofill can still attach the file, but the assistant can’t read it.
              Export a text-based PDF or a Word file and replace it.
            </Note>
          )}
          {over && <div className="pf-drop-overlay">Drop to replace</div>}
        </div>
      ) : (
        <button type="button" className={`pf-dropzone${over ? ' is-over' : ''}`} onClick={choose} disabled={busy} {...dragProps}>
          <span className="pf-dropzone-icon">
            <Icon name="upload" />
          </span>
          <strong>{busy ? 'Reading your resume…' : 'Drop your resume here, or choose a file'}</strong>
          <span>PDF, Word (.docx), plain text or Markdown · up to 15 MB</span>
        </button>
      )}
      {error && (
        <Note tone="danger">{error}</Note>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// The panel

const ANSWER_IDEAS = ['How did you hear about us?', 'Earliest start date', 'Are you willing to relocate?', 'Expected graduation date']
const DEGREES = ['High school diploma', 'Associate', 'B.S.', 'B.A.', 'B.Eng.', 'M.S.', 'M.Eng.', 'MBA', 'Ph.D.']

// Resumes and tracks are saved by their own calls, so they never make the form dirty.
const comparable = (p: Profile) => JSON.stringify({ ...p, resume: null, tracks: [] })
let localId = 0
const newAnswerId = () => `new-${Date.now().toString(36)}-${localId++}`

function initials(p: Profile): string {
  const first = (p.preferredName || p.legalFirstName).trim()
  const last = p.legalLastName.trim()
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase()
}

function completion(p: Profile): { done: number; total: number } {
  const checks = [
    !!(p.legalFirstName && p.legalLastName),
    !!(p.email && p.phone),
    !!(p.city || p.country),
    !!(p.linkedin || p.github || p.website),
    p.education.length > 0,
    p.authorizedToWorkUS !== null && p.needsSponsorship !== null,
    !!p.resume,
    p.preferences.targetRoles.length > 0,
  ]
  return { done: checks.filter(Boolean).length, total: checks.length }
}

/** What Settings can ask the panel to do when the user leaves with unsaved edits. */
export interface ProfileActions {
  /** Resolves true once saved; false if there were errors to fix or the save failed. */
  save: () => Promise<boolean>
  discard: () => void
}

export function ProfilePanel({ actions, onDirtyChange }: { actions?: Ref<ProfileActions>; onDirtyChange?: (dirty: boolean) => void } = {}) {
  const [base, setBase] = useState<Profile | null>(null)
  const [draft, setDraft] = useState<Profile>(EMPTY_PROFILE)
  const [status, setStatus] = useState<ProfileStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const dirty = base !== null && comparable(base) !== comparable(draft)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const onDirtyRef = useRef(onDirtyChange)
  onDirtyRef.current = onDirtyChange
  useEffect(() => {
    onDirtyRef.current?.(dirty)
  }, [dirty])
  useEffect(() => () => onDirtyRef.current?.(false), [])

  const load = useCallback(() => {
    api
      .invoke('profile:get')
      .then((p) => {
        setBase(p)
        // Keep the user's unsaved edits if something else (the assistant) changed the profile.
        if (!dirtyRef.current) setDraft(p)
        else setDraft((d) => ({ ...d, resume: p.resume, tracks: p.tracks }))
        setLoadError(null)
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])

  useEffect(() => {
    load()
    api.invoke('profile:status').then(setStatus).catch(() => {})
    return api.on('profile:changed', load)
  }, [load])

  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => setJustSaved(false), 2500)
    return () => clearTimeout(t)
  }, [justSaved])

  const errors = useMemo(() => validateProfile(draft), [draft])
  const errorCount = Object.keys(errors).length
  const err = (path: string) => (showAll || touched.has(path) ? errors[path] : undefined)
  const touch = (path: string) => () => setTouched((t) => (t.has(path) ? t : new Set(t).add(path)))

  const update = (fn: (p: Profile) => Profile) => {
    setDraft(fn)
    setSaveError(null)
    setJustSaved(false)
  }
  const set = <K extends keyof Profile>(k: K) => (v: Profile[K]) => update((p) => ({ ...p, [k]: v }))
  const setPref = <K extends keyof SearchPreferences>(k: K) => (v: SearchPreferences[K]) => update((p) => ({ ...p, preferences: { ...p.preferences, [k]: v } }))
  const setDemo = (k: keyof Demographics) => (v: string) => update((p) => ({ ...p, demographics: { ...p.demographics, [k]: v } }))
  const setEdu = (i: number, k: keyof Education) => (v: string) =>
    update((p) => ({ ...p, education: p.education.map((e, j) => (j === i ? { ...e, [k]: v } : e)) }))
  const setAnswer = (i: number, k: 'question' | 'answer') => (v: string) =>
    update((p) => ({ ...p, answers: p.answers.map((a, j) => (j === i ? { ...a, [k]: v } : a)) }))

  const text = (k: 'legalFirstName' | 'legalLastName' | 'preferredName' | 'email' | 'phone' | 'city' | 'region' | 'country' | 'linkedin' | 'github' | 'website' | 'scholar') => ({
    value: draft[k],
    onChange: set(k),
    onBlur: touch(k),
    error: err(k),
  })

  const save = async (): Promise<boolean> => {
    if (!dirty) return true
    if (saving) return false
    if (errorCount) {
      setShowAll(true)
      requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el?.focus({ preventScroll: true })
      })
      return false
    }
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await api.invoke('profile:save', draft)
      setBase(saved)
      setDraft(saved)
      setTouched(new Set())
      setShowAll(false)
      setJustSaved(true)
      return true
    } catch (e) {
      setSaveError((e as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }
  const discard = () => {
    if (!base) return
    setDraft(base)
    setTouched(new Set())
    setShowAll(false)
    setSaveError(null)
  }
  useImperativeHandle(actions, () => ({ save, discard }))

  const onResumeImported = (r: ResumeImport) => {
    setBase((b) => (b ? { ...b, resume: r.profile.resume } : b))
    setDraft((d) => ({ ...d, resume: r.profile.resume }))
  }
  const onResumeRemoved = (p: Profile) => {
    setBase((b) => (b ? { ...b, resume: p.resume } : b))
    setDraft((d) => ({ ...d, resume: p.resume }))
  }

  if (loadError) {
    return (
      <div className="settings-scroll">
        <Note tone="danger">Your profile couldn’t be loaded: {loadError}</Note>
      </div>
    )
  }
  if (!base) {
    return (
      <div className="settings-scroll">
        <div className="pf-loading" aria-busy="true" />
      </div>
    )
  }

  const encrypted = status?.encrypted ?? true
  const { done, total } = completion(draft)
  const name = displayName(draft)
  const demoAnswered = Object.values(draft.demographics).filter(Boolean).length
  const where = [draft.city, draft.region, draft.country].filter(Boolean).join(', ')

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
    }
  }

  return (
    <>
      <div className="settings-scroll pf" ref={rootRef} onKeyDown={onKeyDown}>
        <header className="pf-hero">
          <div className="pf-avatar" aria-hidden="true">
            {initials(draft) || <Icon name="user" />}
          </div>
          <div className="pf-hero-text">
            <strong>{name || 'Your profile'}</strong>
            <span>{[draft.email, where].filter(Boolean).join(' · ') || 'Fill in what you’d put on an application. Every field is optional.'}</span>
            <div className="pf-progress" title={`${done} of ${total} essentials filled in`}>
              <div className="pf-progress-bar" aria-hidden="true">
                <i style={{ width: `${(done / total) * 100}%` }} />
              </div>
              <small>
                {done === total ? 'Ready for autofill' : `${done} of ${total} essentials`}
              </small>
            </div>
          </div>
          {status && (
            <span className={`chip ${encrypted ? 'ok' : 'warn'} pf-lock-chip`}>
              <Icon name={encrypted ? 'lock' : 'unlock'} />
              {encrypted ? 'Encrypted' : 'Not encrypted'}
            </span>
          )}
        </header>

        {!encrypted && (
          <Note tone="warn">
            <strong>Your keychain isn’t available.</strong> Your name, contact details, links, education and preferences are saved unencrypted on
            this computer. Saved answers and demographics are turned off until the keychain is available, so they’re never stored in the clear.
          </Note>
        )}

        <Section id="name" title="Name" hint="Use your legal name as it appears on official documents. Applications that ask for a preferred name get that instead.">
          <div className="grid-3">
            <TextField label="Legal first name" autoComplete="given-name" {...text('legalFirstName')} />
            <TextField label="Legal last name" autoComplete="family-name" {...text('legalLastName')} />
            <TextField label="Preferred name" placeholder="Optional" autoComplete="nickname" {...text('preferredName')} />
          </div>
        </Section>

        <Section id="contact" title="Contact" hint="Where recruiters reach you.">
          <div className="grid-2">
            <TextField label="Email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" {...text('email')} />
            <TextField label="Phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 555 010 0199" {...text('phone')} />
          </div>
          <div className="grid-3">
            <TextField label="City" autoComplete="address-level2" {...text('city')} />
            <TextField label="State or region" autoComplete="address-level1" {...text('region')} />
            <TextField label="Country" autoComplete="country-name" {...text('country')} />
          </div>
        </Section>

        <Section id="links" title="Links" hint="Paste a full link or just the address; https:// is added for you.">
          <div className="grid-2">
            <TextField label="LinkedIn" type="url" inputMode="url" placeholder="linkedin.com/in/your-name" {...text('linkedin')} />
            <TextField label="GitHub" type="url" inputMode="url" placeholder="github.com/your-name" {...text('github')} />
            <TextField label="Website or portfolio" type="url" inputMode="url" placeholder="yourname.dev" {...text('website')} />
            <TextField label="Google Scholar" type="url" inputMode="url" placeholder="scholar.google.com/citations?user=…" {...text('scholar')} />
          </div>
        </Section>

        <Section
          id="education"
          title="Education"
          hint="Most recent first. An expected graduation date is fine."
          aside={
            draft.education.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  update((p) => ({ ...p, education: [...p.education, { ...EMPTY_EDUCATION }] }))
                  setFocusKey(`edu-${draft.education.length}`)
                }}
              >
                <Icon name="plus" />
                Add school
              </button>
            )
          }
        >
          <datalist id="pf-degrees">
            {DEGREES.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          {draft.education.length === 0 ? (
            <button
              type="button"
              className="pf-empty-add"
              onClick={() => {
                update((p) => ({ ...p, education: [{ ...EMPTY_EDUCATION }] }))
                setFocusKey('edu-0')
              }}
            >
              <Icon name="plus" />
              Add a school
            </button>
          ) : (
            draft.education.map((e, i) => (
              <div key={i} className="pf-card">
                <div className="pf-card-head">
                  <span>{e.school || (i === 0 ? 'School' : `School ${i + 1}`)}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${e.school || 'this school'}`}
                    title="Remove"
                    onClick={() => update((p) => ({ ...p, education: p.education.filter((_, j) => j !== i) }))}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
                <div className="grid-2">
                  <TextField
                    wide
                    label="School"
                    value={e.school}
                    onChange={setEdu(i, 'school')}
                    onBlur={touch(`education.${i}.school`)}
                    error={err(`education.${i}.school`)}
                    autoFocus={focusKey === `edu-${i}`}
                  />
                  <TextField label="Degree" list="pf-degrees" placeholder="B.S." value={e.degree} onChange={setEdu(i, 'degree')} />
                  <TextField label="Field of study" placeholder="Computer Science" value={e.field} onChange={setEdu(i, 'field')} />
                </div>
                <div className="grid-3">
                  <TextField
                    label="Start"
                    type="month"
                    value={e.startDate}
                    onChange={setEdu(i, 'startDate')}
                    onBlur={touch(`education.${i}.startDate`)}
                    error={err(`education.${i}.startDate`)}
                  />
                  <TextField
                    label="End or expected"
                    type="month"
                    value={e.endDate}
                    onChange={setEdu(i, 'endDate')}
                    onBlur={touch(`education.${i}.endDate`)}
                    error={err(`education.${i}.endDate`)}
                  />
                  <TextField
                    label="GPA"
                    inputMode="decimal"
                    placeholder="3.8/4.0"
                    value={e.gpa}
                    onChange={setEdu(i, 'gpa')}
                    onBlur={touch(`education.${i}.gpa`)}
                    error={err(`education.${i}.gpa`)}
                  />
                </div>
              </div>
            ))
          )}
        </Section>

        <Section id="auth" title="Work authorization" hint="Asked on almost every US application. “Not set” leaves the question for you to answer each time.">
          <div className="pf-tri-list">
            <Segmented label="Authorized to work in the US" value={draft.authorizedToWorkUS} onChange={set('authorizedToWorkUS')} />
            <Segmented
              label="Will need visa sponsorship"
              hint="Now or in the future, e.g. for an H-1B after graduating."
              value={draft.needsSponsorship}
              onChange={set('needsSponsorship')}
            />
          </div>
        </Section>

        <ResumeSection resume={draft.resume} defaultTrack={draft.tracks[0]?.name} onImported={onResumeImported} onRemoved={onResumeRemoved} />

        <Section id="prefs" title="What you’re looking for" hint="Autosearch and the assistant use this to find and rank roles. Press Enter or a comma after each item.">
          <ChipInput label="Target roles" placeholder="e.g. ML inference intern" values={draft.preferences.targetRoles} onChange={setPref('targetRoles')} />
          <ChipInput label="Locations" placeholder="e.g. San Francisco Bay Area" values={draft.preferences.locations} onChange={setPref('locations')} />
          <Switch
            label="Remote roles are fine"
            hint="Include remote postings wherever you’re located."
            checked={draft.preferences.remoteOk}
            onChange={setPref('remoteOk')}
          />
          <div className="grid-2">
            <ChipInput label="Keywords to look for" placeholder="e.g. CUDA, compilers" values={draft.preferences.keywords} onChange={setPref('keywords')} />
            <ChipInput
              label="Skip postings that mention"
              placeholder="e.g. sales"
              values={draft.preferences.excludeKeywords}
              onChange={setPref('excludeKeywords')}
              tone="muted"
            />
            <TextField label="Term" placeholder="Summer 2027" value={draft.preferences.term} onChange={setPref('term')} />
            <TextField label="Minimum pay" placeholder="$35/hr" hint="Roles that clearly pay less are ranked lower." value={draft.preferences.minPay} onChange={setPref('minPay')} />
          </div>
          <div className="field">
            <label htmlFor="pf-notes">Anything else</label>
            <textarea
              id="pf-notes"
              rows={3}
              placeholder="Team size, industries, what you want to learn… The assistant reads this."
              value={draft.preferences.notes}
              onChange={(e) => setPref('notes')(e.target.value)}
            />
          </div>
        </Section>

        <Section
          id="answers"
          title="Saved answers"
          hint="Answers to questions that come up again and again. The assistant and autofill reuse them, and you can edit them here."
          aside={
            encrypted &&
            draft.answers.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  update((p) => ({ ...p, answers: [...p.answers, { id: newAnswerId(), question: '', answer: '' }] }))
                  setFocusKey(`ans-${draft.answers.length}-q`)
                }}
              >
                <Icon name="plus" />
                Add answer
              </button>
            )
          }
        >
          {!encrypted ? (
            <Note tone="warn">Saved answers need the keychain so they’re stored encrypted. Unlock or set up your keychain to use them.</Note>
          ) : draft.answers.length === 0 ? (
            <div className="pf-ideas">
              <span>Start with a common one:</span>
              {ANSWER_IDEAS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="pf-idea"
                  onClick={() => {
                    update((p) => ({ ...p, answers: [...p.answers, { id: newAnswerId(), question: q, answer: '' }] }))
                    setFocusKey(`ans-${draft.answers.length}-a`)
                  }}
                >
                  <Icon name="plus" />
                  {q}
                </button>
              ))}
              <button
                type="button"
                className="pf-idea"
                onClick={() => {
                  update((p) => ({ ...p, answers: [...p.answers, { id: newAnswerId(), question: '', answer: '' }] }))
                  setFocusKey(`ans-0-q`)
                }}
              >
                <Icon name="plus" />
                Your own question
              </button>
            </div>
          ) : (
            draft.answers.map((a: SavedAnswer, i) => (
              <div key={a.id || i} className="pf-card pf-answer">
                <div className="pf-answer-fields">
                  <TextField
                    label="Question"
                    placeholder="e.g. Why do you want to work here?"
                    value={a.question}
                    onChange={setAnswer(i, 'question')}
                    onBlur={touch(`answers.${i}.question`)}
                    error={err(`answers.${i}.question`)}
                    autoFocus={focusKey === `ans-${i}-q`}
                  />
                  <div className="field">
                    <label htmlFor={`pf-ans-${i}`}>Answer</label>
                    <textarea
                      id={`pf-ans-${i}`}
                      rows={2}
                      value={a.answer}
                      onChange={(e) => setAnswer(i, 'answer')(e.target.value)}
                      autoFocus={focusKey === `ans-${i}-a`}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove answer${a.question ? ` to “${a.question}”` : ''}`}
                  title="Remove"
                  onClick={() => update((p) => ({ ...p, answers: p.answers.filter((_, j) => j !== i) }))}
                >
                  <Icon name="trash" />
                </button>
              </div>
            ))
          )}
        </Section>

        <section className="settings-section pf-section pf-demo" aria-labelledby="pf-demo">
          <button type="button" className="pf-demo-toggle" aria-expanded={demoOpen} aria-controls="pf-demo-body" onClick={() => setDemoOpen((o) => !o)}>
            <span>
              <h3 id="pf-demo">
                Voluntary demographics <span className="chip">Optional</span>
              </h3>
              <small>{demoAnswered ? `${demoAnswered} of 6 answered` : 'Not filled in. Applications will ask you each time.'}</small>
            </span>
            <Icon name="chevronDown" />
          </button>
          {demoOpen && (
            <div id="pf-demo-body" className="pf-demo-body">
              <Note tone="info">
                These only fill the same voluntary questions on applications, and they stay encrypted on this computer. The assistant never sees them.
              </Note>
              {!encrypted && <Note tone="warn">Demographics need the keychain so they’re stored encrypted, so they’re turned off on this computer.</Note>}
              <div className="grid-2">
                <ChoiceSelect label="Gender" value={draft.demographics.gender} options={DEMOGRAPHIC_FIELDS[0]!.options} onChange={setDemo('gender')} disabled={!encrypted} />
                <PronounsField value={draft.demographics.pronouns} onChange={setDemo('pronouns')} disabled={!encrypted} />
                {DEMOGRAPHIC_FIELDS.slice(1).map((f) => (
                  <ChoiceSelect key={f.key} label={f.label} value={draft.demographics[f.key]} options={f.options} onChange={setDemo(f.key)} disabled={!encrypted} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <footer className={`settings-pane-foot pf-footer${dirty ? ' is-dirty' : ''}`} onKeyDown={onKeyDown}>
        <span className="pf-footer-status" role="status" aria-live="polite">
          {saving ? (
            'Saving…'
          ) : saveError ? (
            <span className="is-error">
              <Icon name="alert" />
              {saveError}
            </span>
          ) : showAll && errorCount ? (
            <span className="is-error">
              <Icon name="alert" />
              {errorCount === 1 ? 'Fix the highlighted field to save.' : `Fix the ${errorCount} highlighted fields to save.`}
            </span>
          ) : dirty ? (
            <span className="is-dirty">
              <i className="pf-dirty-dot" aria-hidden="true" />
              Unsaved changes
            </span>
          ) : justSaved ? (
            <span className="is-saved">
              <Icon name="check" />
              Saved
            </span>
          ) : (
            <span>
              <Icon name="lock" />
              {encrypted ? 'All changes saved, encrypted on this computer' : 'All changes saved on this computer'}
            </span>
          )}
        </span>
        <button type="button" className="btn btn-ghost" onClick={discard} disabled={!dirty || saving}>
          Discard
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </footer>
    </>
  )
}
