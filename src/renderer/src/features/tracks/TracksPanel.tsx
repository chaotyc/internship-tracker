import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import { PaneHeader } from '@renderer/features/settings/PaneHeader'
import { ChipInput, fullDate, Note, words } from '@renderer/features/settings/ProfilePanel'
import {
  RESUME_EXTENSIONS,
  RESUME_MAX_BYTES,
  validateTrack,
  type ApplicationTrack,
  type Profile,
  type ResumeImport,
  type SavedAnswer,
  type TrackPatch,
} from '@shared/profile'
import '@renderer/features/settings/profile.css'
import './tracks.css'

let localId = 0
const newAnswerId = () => `new-${Date.now().toString(36)}-${localId++}`
const SAVE_DELAY = 900
const NAME_REQUIRED = 'Give this track a name.'

// ---------------------------------------------------------------------------
// Resume for one track

function TrackResume({ track, onProfile, onRemove }: { track: ApplicationTrack; onProfile: (p: Profile) => void; onRemove: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [showText, setShowText] = useState(false)
  const resume = track.resume

  const run = async (fn: () => Promise<ResumeImport | null>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fn()
      if (res) {
        onProfile(res.profile)
        setWarning(res.warning)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const choose = () => run(() => api.invoke('profile:importTrackResume', { id: track.id }))
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!(RESUME_EXTENSIONS as readonly string[]).includes(ext)) return setError('Drop a PDF, Word (.docx), text or Markdown file.')
    if (file.size > RESUME_MAX_BYTES) return setError('That file is over 15 MB. Resumes are usually well under 1 MB.')
    void run(async () => api.invoke('profile:importTrackResumeData', { id: track.id, fileName: file.name, data: new Uint8Array(await file.arrayBuffer()) }))
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

  return (
    <div className="trk-resume">
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
                {resume.text ? ' · text extracted' : ' · no text found'}
              </span>
            </div>
            <div className="pf-resume-actions">
              <button type="button" className="btn btn-sm" onClick={choose} disabled={busy}>
                <Icon name="upload" />
                {busy ? 'Reading…' : 'Replace'}
              </button>
              <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={onRemove} disabled={busy} aria-label={`Remove the resume from ${track.name || 'this track'}`}>
                <Icon name="trash" />
                Remove
              </button>
            </div>
          </div>
          {resume.text ? (
            <>
              <button type="button" className="settings-disclosure" aria-expanded={showText} onClick={() => setShowText((s) => !s)}>
                <Icon name="chevronDown" />
                {showText ? 'Hide extracted text' : 'Show extracted text'}
              </button>
              {showText && (
                <pre className="pf-resume-text" tabIndex={0} aria-label={`Text read from the resume for ${track.name}`}>
                  {resume.text}
                </pre>
              )}
            </>
          ) : (
            <Note tone="warn">{warning ?? 'No text found; it may be a scanned image. Autofill can still attach the file, but the assistant can’t read it.'}</Note>
          )}
          {over && <div className="pf-drop-overlay">Drop to replace</div>}
        </div>
      ) : (
        <button type="button" className={`pf-dropzone trk-dropzone${over ? ' is-over' : ''}`} onClick={choose} disabled={busy} {...dragProps}>
          <span className="pf-dropzone-icon">
            <Icon name="upload" />
          </span>
          <span className="trk-dropzone-text">
            <strong>{busy ? 'Reading the resume…' : `Add a resume for ${track.name}`}</strong>
            <span>Drop a file or choose one · PDF, Word, text or Markdown</span>
          </span>
        </button>
      )}
      {error && <Note tone="danger">{error}</Note>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// "⋯" menu: reorder and delete, out of the way until needed

interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

function TrackMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Close the menu, not the Settings dialog.
      e.preventDefault()
      e.stopPropagation()
      close(true)
      return
    }
    if (e.key === 'Tab') return setOpen(false)
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const btns = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    btns[(i + d + btns.length) % btns.length]?.focus()
  }

  return (
    <div ref={wrap} className="trk-menu-wrap">
      <button
        ref={button}
        type="button"
        className={`icon-btn trk-more${open ? ' is-open' : ''}`}
        aria-label={`More actions for ${name || 'this track'}`}
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div ref={menu} id={menuId} className="trk-menu" role="menu" aria-label={`Actions for ${name || 'this track'}`} onKeyDown={onKeyDown}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? 'is-danger' : undefined}
              disabled={it.disabled}
              onClick={() => {
                close(!it.danger)
                it.onSelect()
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One track

type Draft = Pick<ApplicationTrack, 'name' | 'description' | 'targetRoles' | 'keywords' | 'answers'>
const draftOf = (t: ApplicationTrack): Draft => ({ name: t.name, description: t.description, targetRoles: t.targetRoles, keywords: t.keywords, answers: t.answers })
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

interface CardProps {
  track: ApplicationTrack
  index: number
  count: number
  profileAnswers: SavedAnswer[]
  encrypted: boolean
  autoFocusName: boolean
  onProfile: (p: Profile) => void
  onMove: (dir: -1 | 1) => void
  onMakeDefault: () => void
  onDeleted: (p: Profile) => void
}

function TrackCard({ track, index, count, profileAnswers, encrypted, autoFocusName, onProfile, onMove, onMakeDefault, onDeleted }: CardProps) {
  const uid = useId()
  const [draft, setDraft] = useState<Draft>(() => draftOf(track))
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ kind: 'track'; roles: number } | { kind: 'resume' } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [touched, setTouched] = useState<Set<number>>(() => new Set())
  const cardRef = useRef<HTMLElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(draft)
  latest.current = draft
  const dirty = useRef(false)
  const isDefault = index === 0

  // Take in changes made elsewhere (another window, the demo) unless the user is mid-edit here.
  useEffect(() => {
    if (dirty.current || cardRef.current?.contains(document.activeElement)) return
    setDraft(draftOf(track))
  }, [track])

  useEffect(() => {
    if (!autoFocusName) return
    nameRef.current?.focus()
    nameRef.current?.select()
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [autoFocusName])

  const errors = validateTrack({ ...track, ...draft })
  // A cleared name isn't saved; say so under the name instead of failing quietly.
  const nameErr = state === 'error' && !draft.name.trim() ? NAME_REQUIRED : undefined

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!dirty.current) return
    const d = latest.current
    if (!d.name.trim() || Object.keys(validateTrack({ ...track, ...d })).length) {
      setState('error')
      return
    }
    dirty.current = false
    setState('saving')
    setError(null)
    try {
      const patch: TrackPatch = d
      onProfile(await api.invoke('profile:updateTrack', { id: track.id, patch }))
      setState((s) => (s === 'saving' ? 'saved' : s))
    } catch (e) {
      dirty.current = true
      setState('error')
      setError((e as Error).message)
    }
  }, [track, onProfile])

  // Save what's left when the panel closes.
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => void flushRef.current(), [])

  useEffect(() => {
    if (state !== 'saved') return
    const t = setTimeout(() => setState('idle'), 1800)
    return () => clearTimeout(t)
  }, [state])

  const edit = (fn: (d: Draft) => Draft, now = false) => {
    const next = fn(latest.current)
    latest.current = next
    setDraft(next)
    dirty.current = true
    setState('pending')
    if (timer.current) clearTimeout(timer.current)
    if (now) queueMicrotask(() => void flush())
    else timer.current = setTimeout(() => void flush(), SAVE_DELAY)
  }
  const setAnswer = (i: number, k: 'question' | 'answer', v: string) => edit((d) => ({ ...d, answers: d.answers.map((a, j) => (j === i ? { ...a, [k]: v } : a)) }))
  const addAnswer = (question: string) => {
    const i = latest.current.answers.length
    edit((d) => ({ ...d, answers: [...d.answers, { id: newAnswerId(), question, answer: '' }] }), true)
    setFocusKey(question ? `a-${i}` : `q-${i}`)
  }

  const overridden = new Set(draft.answers.map((a) => a.question.trim().toLowerCase()))
  const ideas = profileAnswers.filter((a) => a.question.trim() && !overridden.has(a.question.trim().toLowerCase())).slice(0, 4)

  const askDelete = async () => {
    const roles = await api.invoke('roles:list').catch(() => [])
    setConfirming({ kind: 'track', roles: roles.filter((r) => r.trackId === track.id).length })
  }
  const removeResume = async () => {
    setDeleting(true)
    try {
      onProfile(await api.invoke('profile:removeTrackResume', { id: track.id }))
      setConfirming(null)
    } catch (e) {
      setError((e as Error).message)
      setConfirming(null)
    } finally {
      setDeleting(false)
    }
  }
  const doDelete = async () => {
    setDeleting(true)
    try {
      if (timer.current) clearTimeout(timer.current)
      dirty.current = false
      onDeleted(await api.invoke('profile:deleteTrack', { id: track.id }))
    } catch (e) {
      setError((e as Error).message)
      setDeleting(false)
      setConfirming(null)
    }
  }

  const status =
    state === 'saving' || state === 'pending' ? (
      <span className="trk-status">Saving…</span>
    ) : state === 'saved' ? (
      <span className="trk-status is-saved">
        <Icon name="check" />
        Saved
      </span>
    ) : state === 'error' ? (
      <span className="trk-status is-error">Not saved</span>
    ) : null

  return (
    <article ref={cardRef} className={`trk-card${isDefault ? ' is-default' : ''}`} aria-labelledby={`${uid}-name`} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && void flush()}>
      <header className="trk-card-head">
        {/* The same neutral file tile for every track, so it can't read as a company logo. */}
        <span className="trk-badge" aria-hidden="true">
          <Icon name="file" />
        </span>
        <div className="trk-title">
          {/* Clicking the pencil focuses the name, like clicking the name itself. */}
          <label className="trk-name-row">
            <input
              ref={nameRef}
              id={`${uid}-name`}
              className={`trk-name${nameErr ? ' is-invalid' : ''}`}
              value={draft.name}
              maxLength={80}
              aria-label="Track name"
              aria-invalid={nameErr ? true : undefined}
              aria-describedby={nameErr ? `${uid}-name-err` : undefined}
              title="Rename"
              placeholder="Name this track"
              onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), void flush())}
            />
            <svg className="trk-pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
            </svg>
          </label>
          {nameErr && (
            <small id={`${uid}-name-err`} className="pf-error trk-name-error">
              {nameErr}
            </small>
          )}
          <input
            className="trk-desc"
            value={draft.description}
            maxLength={400}
            aria-label={`Short description of ${draft.name || 'this track'}`}
            placeholder="Short description, e.g. inference runtimes and GPU kernels"
            onChange={(e) => edit((d) => ({ ...d, description: e.target.value }))}
          />
        </div>
        <div className="trk-head-side">
          {status}
          {isDefault ? (
            <span className="chip accent trk-default" title="Roles without a track use this one. The Profile tab’s resume is this track’s.">
              <Icon name="check" />
              Default
            </span>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onMakeDefault}>
              Make default
            </button>
          )}
          <TrackMenu
            name={draft.name}
            items={[
              { label: 'Move up', onSelect: () => onMove(-1), disabled: index === 0 },
              { label: 'Move down', onSelect: () => onMove(1), disabled: index === count - 1 },
              { label: 'Delete track…', onSelect: () => void askDelete(), danger: true },
            ]}
          />
        </div>
      </header>

      {confirming && (
        <div className="trk-confirm" role="alertdialog" aria-labelledby={`${uid}-ct`} aria-describedby={`${uid}-cd`}>
          <Icon name="alert" />
          <div className="trk-confirm-text">
            <strong id={`${uid}-ct`}>{confirming.kind === 'resume' ? `Remove the resume from “${draft.name}”?` : `Delete “${draft.name}”?`}</strong>
            <span id={`${uid}-cd`}>
              {confirming.kind === 'resume'
                ? `${track.resume?.fileName ?? 'The file'} and its extracted text are deleted from this computer.`
                : count === 1
                ? 'Its resume stays as your profile resume.'
                : [track.resume ? 'Its resume file is deleted too.' : '', confirming.roles ? `${confirming.roles} role${confirming.roles === 1 ? '' : 's'} on it will use the default track.` : '']
                    .filter(Boolean)
                    .join(' ') || 'This can’t be undone.'}
            </span>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(null)} disabled={deleting} autoFocus>
            Cancel
          </button>
          {confirming.kind === 'resume' ? (
            <button type="button" className="btn btn-sm trk-confirm-delete" onClick={() => void removeResume()} disabled={deleting}>
              {deleting ? 'Removing…' : 'Remove resume'}
            </button>
          ) : (
            <button type="button" className="btn btn-sm trk-confirm-delete" onClick={() => void doDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete track'}
            </button>
          )}
        </div>
      )}

      <TrackResume track={track} onProfile={onProfile} onRemove={() => setConfirming({ kind: 'resume' })} />

      <div className="trk-grid">
        <ChipInput
          label="Target roles for this track"
          values={draft.targetRoles}
          onChange={(v) => edit((d) => ({ ...d, targetRoles: v }), true)}
          placeholder="e.g. Photonics intern"
        />
        <ChipInput label="Keywords for this track" values={draft.keywords} onChange={(v) => edit((d) => ({ ...d, keywords: v }), true)} placeholder="e.g. silicon photonics, optics" />
      </div>

      <div className="trk-answers">
        <div className="trk-answers-head">
          <div>
            <h4 className="settings-sub">Answer overrides</h4>
            <p className="pf-hint">Used instead of your saved answer for roles on this track.</p>
          </div>
          {encrypted && draft.answers.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => addAnswer('')}>
              <Icon name="plus" />
              Add override
            </button>
          )}
        </div>
        {!encrypted ? (
          <Note tone="warn">Answer overrides need the keychain so they’re stored encrypted. Unlock or set up your keychain to use them.</Note>
        ) : (
          <>
            {draft.answers.map((a, i) => {
              const qErr = touched.has(i) || state === 'error' ? errors[`answers.${i}.question`] : undefined
              return (
                <div key={a.id || i} className="pf-card pf-answer trk-answer">
                  <div className="pf-answer-fields">
                    <div className={`field${qErr ? ' has-error' : ''}`}>
                      <label htmlFor={`${uid}-q${i}`}>Question</label>
                      <input
                        id={`${uid}-q${i}`}
                        value={a.question}
                        placeholder="e.g. Why are you interested in this role?"
                        aria-invalid={qErr ? true : undefined}
                        onChange={(e) => setAnswer(i, 'question', e.target.value)}
                        onBlur={() => setTouched((t) => new Set(t).add(i))}
                        autoFocus={focusKey === `q-${i}`}
                      />
                      {qErr && <small className="pf-error">{qErr}</small>}
                    </div>
                    <div className="field">
                      <label htmlFor={`${uid}-a${i}`}>Answer for this track</label>
                      <textarea id={`${uid}-a${i}`} rows={2} value={a.answer} onChange={(e) => setAnswer(i, 'answer', e.target.value)} autoFocus={focusKey === `a-${i}`} />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove override${a.question ? ` for “${a.question}”` : ''}`}
                    title="Remove"
                    onClick={() => edit((d) => ({ ...d, answers: d.answers.filter((_, j) => j !== i) }), true)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              )
            })}
            {(draft.answers.length === 0 || ideas.length > 0) && (
              <div className="pf-ideas">
                {draft.answers.length === 0 && !ideas.length && <span className="pf-ideas-label">None yet.</span>}
                {draft.answers.length > 0 && <span className="pf-ideas-label">Also override</span>}
                {ideas.map((a) => (
                  <button key={a.id} type="button" className="pf-idea" onClick={() => addAnswer(a.question)}>
                    <Icon name="plus" />
                    {a.question}
                  </button>
                ))}
                {draft.answers.length === 0 && (
                  <button type="button" className="pf-idea" onClick={() => addAnswer('')}>
                    <Icon name="plus" />
                    Your own question
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {error && <Note tone="danger">{error}</Note>}
    </article>
  )
}

// ---------------------------------------------------------------------------
// The panel

export function TracksPanel() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [encrypted, setEncrypted] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .invoke('profile:get')
      .then((p) => {
        setProfile(p)
        setLoadError(null)
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])
  useEffect(() => {
    load()
    api
      .invoke('profile:status')
      .then((s) => setEncrypted(s.encrypted))
      .catch(() => {})
    return api.on('profile:changed', load)
  }, [load])

  const act = async (fn: () => Promise<Profile>) => {
    setError(null)
    try {
      setProfile(await fn())
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const { profile: p, trackId } = await api.invoke('profile:createTrack', {})
      setProfile(p)
      setFocusId(trackId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const onProfile = useCallback((p: Profile) => setProfile(p), [])

  const header = (action?: ReactNode) => (
    <PaneHeader title="Application tracks" description="A resume, target roles and answers for each kind of role you apply to." action={action} />
  )
  if (loadError)
    return (
      <div className="pf trk">
        {header()}
        <Note tone="danger">Your tracks couldn’t be loaded: {loadError}</Note>
      </div>
    )
  if (!profile)
    return (
      <div className="pf trk">
        {header()}
        <div className="pf-loading" aria-busy="true" />
      </div>
    )

  const tracks = profile.tracks
  const move = (i: number, dir: -1 | 1) => {
    const ids = tracks.map((t) => t.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    void act(() => api.invoke('profile:reorderTracks', { ids }))
  }

  return (
    <div className="pf trk">
      {header(
        tracks.length > 1 && (
          <button type="button" className="btn btn-sm" onClick={() => void create()} disabled={busy}>
            <Icon name="plus" />
            Add track
          </button>
        ),
      )}

      {tracks.length === 0 ? (
        <div className="trk-empty">
          <div className="trk-empty-art" aria-hidden="true">
            <span>
              <Icon name="file" />
            </span>
            <span>
              <Icon name="file" />
            </span>
          </div>
          <strong>Use a different resume for each kind of role</strong>
          <p>
            Tracks keep a separate resume, target roles and answers for each kind of role you apply to, like “ML inference” and “Photonics hardware”.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>
            <Icon name="plus" />
            {busy ? 'Creating…' : 'Create your first track'}
          </button>
          <small>
            {profile.resume
              ? `Your current resume (${profile.resume.fileName}), target roles and keywords become the first track, “General”. You can rename it.`
              : 'It starts from your profile’s target roles and keywords, as “General”. You can rename it.'}
          </small>
        </div>
      ) : (
        tracks.map((t, i) => (
          <TrackCard
            key={t.id}
            track={t}
            index={i}
            count={tracks.length}
            profileAnswers={profile.answers}
            encrypted={encrypted}
            autoFocusName={focusId === t.id}
            onProfile={onProfile}
            onMove={(dir) => move(i, dir)}
            onMakeDefault={() => void act(() => api.invoke('profile:setDefaultTrack', { id: t.id }))}
            onDeleted={setProfile}
          />
        ))
      )}
      {tracks.length === 1 && (
        <button type="button" className="pf-empty-add" onClick={() => void create()} disabled={busy}>
          <Icon name="plus" />
          Add a second track, e.g. for a different field
        </button>
      )}
      {error && <Note tone="danger">{error}</Note>}
    </div>
  )
}
