import { useCallback, useEffect, useImperativeHandle, useMemo, useState, type Ref } from 'react'
import { validateProfile, type Profile } from '@shared/profile'
import { Icon } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import { Note, ResumeSection, TextField } from '@renderer/features/settings/ProfilePanel'

/** The few profile fields the tour asks for. Everything else stays in Settings > Profile. */
const FIELDS = ['legalFirstName', 'legalLastName', 'email', 'phone'] as const
type Key = (typeof FIELDS)[number]
type Contact = Record<Key, string>

const pick = (p: Profile): Contact => ({ legalFirstName: p.legalFirstName, legalLastName: p.legalLastName, email: p.email, phone: p.phone })

export interface ProfileStepActions {
  /** Saves changed contact details. False (and errors shown) when something needs fixing. */
  save: () => Promise<boolean>
}

/** Tour step: a resume and basic contact details, through the same channels and pieces as Settings > Profile. */
export function ProfileStep({ actions, encrypted }: { actions?: Ref<ProfileStepActions>; encrypted: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [draft, setDraft] = useState<Contact | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [touched, setTouched] = useState<Set<Key>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(() => {
    setLoadError(null)
    api
      .invoke('profile:get')
      .then((p) => {
        setProfile(p)
        setDraft(pick(p))
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])
  useEffect(load, [load])

  const errors = useMemo(() => (profile && draft ? validateProfile({ ...profile, ...draft }) : {}), [profile, draft])
  const dirty = !!profile && !!draft && FIELDS.some((k) => profile[k] !== draft[k])

  const save = async (): Promise<boolean> => {
    if (!dirty || !draft) return true
    if (FIELDS.some((k) => errors[k])) {
      setShowAll(true)
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('.onb-step [aria-invalid="true"]')
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el?.focus({ preventScroll: true })
      })
      return false
    }
    setSaveError(null)
    try {
      // Lay the edits over the latest saved profile, so nothing changed elsewhere is lost.
      const latest = await api.invoke('profile:get')
      const next = await api.invoke('profile:save', { ...latest, ...draft })
      setProfile(next)
      setDraft(pick(next))
      setTouched(new Set())
      setShowAll(false)
      setSaved(true)
      return true
    } catch (e) {
      setSaveError((e as Error).message)
      return false
    }
  }
  useImperativeHandle(actions, () => ({ save }))

  if (loadError) {
    return (
      <div className="banner error" role="alert">
        <Icon name="alert" />
        Couldn’t load your profile: {loadError}
        <button type="button" className="btn btn-sm" onClick={load}>
          Try again
        </button>
      </div>
    )
  }
  if (!profile || !draft) return <div className="pf-loading onb-loading" aria-busy="true" />

  const field = (k: Key) => ({
    value: draft[k],
    onChange: (v: string) => {
      setDraft((d) => (d ? { ...d, [k]: v } : d))
      setSaved(false)
    },
    onBlur: () => setTouched((t) => new Set(t).add(k)),
    error: showAll || touched.has(k) ? errors[k] : undefined,
  })

  return (
    <div className="onb-profile pf">
      <ResumeSection
        resume={profile.resume}
        defaultTrack={profile.tracks[0]?.name}
        onImported={(r) => setProfile((p) => (p ? { ...p, resume: r.profile.resume, tracks: r.profile.tracks } : p))}
        onRemoved={(p) => setProfile((cur) => (cur ? { ...cur, resume: p.resume, tracks: p.tracks } : cur))}
      />
      <section className="settings-section pf-section" aria-labelledby="onb-contact">
        <div className="pf-section-head">
          <div>
            <h3 id="onb-contact">Contact details</h3>
            <p className="pf-hint">Autofill puts these into applications. Use your legal name as it appears on official documents.</p>
          </div>
          {saved && !dirty && (
            <span className="chip ok" role="status">
              <Icon name="check" />
              Saved
            </span>
          )}
        </div>
        {!encrypted && (
          <Note tone="warn">
            <strong>Your keychain isn’t available,</strong> so contact details are saved unencrypted on this computer.
          </Note>
        )}
        <div className="grid-2">
          <TextField label="Legal first name" autoComplete="given-name" {...field('legalFirstName')} />
          <TextField label="Legal last name" autoComplete="family-name" {...field('legalLastName')} />
          <TextField label="Email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" {...field('email')} />
          <TextField label="Phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 555 010 0199" {...field('phone')} />
        </div>
        {saveError && <Note tone="danger">{saveError}</Note>}
        <p className="onb-muted">Saved when you click Next.</p>
      </section>
    </div>
  )
}
