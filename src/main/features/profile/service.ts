import {
  describeErrors,
  EMPTY_PROFILE,
  mergeWithDefaults,
  normalizeProfile,
  validateProfile,
  type Profile,
  type ProfileErrors,
  type StoredResume,
  type ApplicationTrack,
  profileTracks,
  resumeForTrack,
  trackById,
} from '@shared/profile'
import type { Store } from '../../db/store'
import type { Secrets } from '../../secrets'
import type { Settings } from '../../settings'

/** What other features use (chat, autofill, search). */
export interface ProfileService {
  get(): Profile
  save(profile: Profile): Profile
  /**
   * Always at least one track: the user's tracks (the first is the default), or the
   * implicit default built from the profile. Each carries its full resume text,
   * target roles, keywords and answer overrides, so search can score a posting
   * against every track.
   */
  tracks(): ApplicationTrack[]
  /** The track for a role's trackId, falling back to the default (first) track. */
  trackFor(trackId: string): ApplicationTrack
  /** The resume to use for a role: its track's resume, else the default track's (the profile's) resume. */
  resumeFor(trackId: string): StoredResume | null
}

/** Thrown by save() when a field is clearly wrong. `message` is ready to show. */
export class ProfileValidationError extends Error {
  constructor(readonly errors: ProfileErrors) {
    super(describeErrors(errors))
    this.name = 'ProfileValidationError'
  }
}

/** Key in the `secrets` table (encrypted) and in `settings` (plain fallback). */
const KEY = 'profile'

interface Deps {
  store: Store
  secrets: Secrets
  settings: Settings
  /** Called after every write; index.ts emits `profile:changed`. */
  onChange?: () => void
}

/**
 * Stores the whole profile as one JSON document.
 *
 * With the OS keychain available (the normal case on macOS and Windows, and on
 * Linux with a secret service), the document is encrypted with Electron's
 * safeStorage via ctx.secrets, and any older plain copy in `settings` is
 * removed so nothing readable is left on disk.
 *
 * Without a keychain (some Linux setups, locked-down machines) we have a choice:
 * refuse to store anything, or store some of it in plain JSON. Refusing would make
 * the app useless for autofill and search, and most of the profile (name, email,
 * links, education, preferences) is what you'd put on a public resume anyway. So
 * we store those in plain settings, but never the voluntary demographics or saved
 * answers, which can be genuinely sensitive (disability, veteran status, salary
 * history). Those are dropped on save and the UI says why.
 */
export class EncryptedProfileService implements ProfileService {
  constructor(private readonly deps: Deps) {}

  tracks(): ApplicationTrack[] {
    return profileTracks(this.get())
  }

  trackFor(trackId: string): ApplicationTrack {
    return trackById(this.get(), trackId)
  }

  resumeFor(trackId: string): StoredResume | null {
    return resumeForTrack(this.get(), trackId)
  }

  /** True when the profile is encrypted at rest. */
  get encrypted(): boolean {
    return this.deps.secrets.available
  }

  get(): Profile {
    const { secrets, settings } = this.deps
    if (secrets.available) {
      const raw = secrets.get(KEY)
      if (raw !== null) {
        try {
          return mergeWithDefaults(JSON.parse(raw))
        } catch {
          // Corrupt payload: fall through to the plain copy (if any) rather than crash.
        }
      }
    }
    return mergeWithDefaults(settings.get<unknown>(KEY, EMPTY_PROFILE))
  }

  /**
   * Normalizes, validates and stores. Resumes and tracks have their own calls
   * (importResume, the track channels), so the stored ones are kept whatever the
   * caller passes; a form opened before a track changed can't undo that change.
   */
  save(profile: Profile): Profile {
    const current = this.get()
    const next: Profile = { ...normalizeProfile(profile), resume: current.resume, tracks: current.tracks }
    const errors = validateProfile(next)
    if (Object.keys(errors).length) throw new ProfileValidationError(errors)
    this.write(next)
    return this.get()
  }

  /**
   * Replaces (or clears) the profile's resume without touching anything else.
   * Once tracks exist, that is the default track's resume.
   */
  setResume(resume: StoredResume | null): Profile {
    const p = this.get()
    if (p.tracks.length) return this.setTrackResume(p.tracks[0]!.id, resume)
    this.write({ ...p, resume })
    return this.get()
  }

  /** Replaces (or clears) one track's resume. */
  setTrackResume(trackId: string, resume: StoredResume | null): Profile {
    const p = this.get()
    if (!p.tracks.some((t) => t.id === trackId)) throw new Error('That application track no longer exists.')
    this.write({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, resume } : t)) })
    return this.get()
  }

  /**
   * Stores a new track list (normalized and validated) as is, resumes included.
   * `resume` is the profile's resume to keep when the list becomes empty.
   */
  setTracks(tracks: ApplicationTrack[], resume?: StoredResume | null): Profile {
    const p = this.get()
    const next = normalizeProfile({ ...p, tracks })
    const errors = validateProfile({ ...EMPTY_PROFILE, tracks: next.tracks })
    if (Object.keys(errors).length) throw new ProfileValidationError(errors)
    this.write({ ...p, tracks: next.tracks, resume: resume === undefined ? p.resume : resume })
    return this.get()
  }

  private write(input: Profile): void {
    const { store, secrets, settings } = this.deps
    // The profile's resume is the default track's while tracks exist, so readers
    // that only know about `resume` (autofill, older code) see the default one.
    const profile: Profile = input.tracks.length ? { ...input, resume: input.tracks[0]!.resume } : input
    if (secrets.available) {
      secrets.set(KEY, JSON.stringify(profile))
      store.run('DELETE FROM settings WHERE key = ?', [KEY])
    } else {
      settings.set<Profile>(KEY, {
        ...profile,
        demographics: { ...EMPTY_PROFILE.demographics },
        answers: [],
        tracks: profile.tracks.map((t) => ({ ...t, answers: [] })),
      })
    }
    this.deps.onChange?.()
  }
}
