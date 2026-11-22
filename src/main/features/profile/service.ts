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
  defaultTrack,
} from '@shared/profile'
import type { Store } from '../../db/store'
import type { Secrets } from '../../secrets'
import type { Settings } from '../../settings'

/** What other features use (chat, autofill, search). */
export interface ProfileService {
  get(): Profile
  save(profile: Profile): Profile
  /** Always at least one track: the user's tracks, or the implicit default built from the profile. */
  tracks(): ApplicationTrack[]
  /** The track for a role's trackId, falling back to the first track. */
  trackFor(trackId: string): ApplicationTrack
  /** The resume to use for a role: its track's resume, else the profile's resume. */
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

export const KEYCHAIN_UNAVAILABLE_REASON =
  "This computer's keychain isn't available, so demographic answers and saved answers can't be encrypted. They won't be stored until it is."

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
    const p = this.get()
    return p.tracks.length ? p.tracks : [defaultTrack(p)]
  }

  trackFor(trackId: string): ApplicationTrack {
    const all = this.tracks()
    return all.find((t) => t.id === trackId) ?? all[0]!
  }

  resumeFor(trackId: string): StoredResume | null {
    return this.trackFor(trackId).resume ?? this.get().resume
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
   * Normalizes, validates and stores. The resume is managed by importResume /
   * removeResume, so the stored one is kept whatever the caller passes.
   */
  save(profile: Profile): Profile {
    const current = this.get()
    const next: Profile = { ...normalizeProfile(profile), resume: current.resume }
    const errors = validateProfile(next)
    if (Object.keys(errors).length) throw new ProfileValidationError(errors)
    this.write(next)
    return this.get()
  }

  /** Replaces (or clears) the stored resume without touching anything else. */
  setResume(resume: StoredResume | null): Profile {
    this.write({ ...this.get(), resume })
    return this.get()
  }

  private write(profile: Profile): void {
    const { store, secrets, settings } = this.deps
    if (secrets.available) {
      secrets.set(KEY, JSON.stringify(profile))
      store.run('DELETE FROM settings WHERE key = ?', [KEY])
    } else {
      settings.set<Profile>(KEY, {
        ...profile,
        demographics: { ...EMPTY_PROFILE.demographics },
        answers: [],
      })
    }
    this.deps.onChange?.()
  }
}
