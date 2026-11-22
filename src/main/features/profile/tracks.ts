import {
  defaultTrack,
  FIRST_TRACK_NAME,
  newTrackId,
  TRACK_ID,
  type ApplicationTrack,
  type Profile,
  type ResumeImport,
  type StoredResume,
  type TrackPatch,
} from '@shared/profile'
import { importResume, removeStoredFile, renameStoredFile, type ResumeTarget } from './resume'
import type { EncryptedProfileService } from './service'

export const MAX_TRACKS = 12

/** Thrown for a request that can't be done. `message` is shown to the user. */
export class TrackError extends Error {}

const filePrefix = (id: string) => `${id}-`

/**
 * Application tracks: creating, editing, ordering and deleting them, and each
 * track's resume copy at <resumesDir>/<trackId>-<file name>. The first track is
 * the default. Data lives in the encrypted profile; this class owns the files.
 */
export class TrackManager {
  constructor(
    private readonly profile: EncryptedProfileService,
    private readonly resumesDir: string,
  ) {}

  private find(p: Profile, id: string): ApplicationTrack {
    const t = p.tracks.find((x) => x.id === id)
    if (!t) throw new TrackError('That application track no longer exists.')
    return t
  }

  /**
   * Adds a track at the end. The first one takes over the profile's resume (its
   * file renamed to the track's prefix), target roles and keywords, so nothing
   * the user already set up is lost.
   */
  create(name?: string, id = newTrackId()): { profile: Profile; trackId: string } {
    const p = this.profile.get()
    if (p.tracks.length >= MAX_TRACKS) throw new TrackError(`You can have up to ${MAX_TRACKS} tracks.`)
    if (!TRACK_ID.test(id) || p.tracks.some((t) => t.id === id)) throw new TrackError('That track id is taken.')
    let track: ApplicationTrack
    if (!p.tracks.length) {
      const base = defaultTrack(p)
      const resume = base.resume ? { ...base.resume, storedPath: renameStoredFile(this.resumesDir, base.resume.storedPath, filePrefix(id)) } : null
      track = { ...base, id, name: name?.trim() || FIRST_TRACK_NAME, resume }
    } else {
      track = { id, name: name?.trim() || 'New track', description: '', resume: null, targetRoles: [], keywords: [], answers: [] }
    }
    return { profile: this.profile.setTracks([...p.tracks, track]), trackId: id }
  }

  update(id: string, patch: TrackPatch): Profile {
    const p = this.profile.get()
    const cur = this.find(p, id)
    const next: ApplicationTrack = {
      ...cur,
      ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
      ...(typeof patch.description === 'string' ? { description: patch.description } : {}),
      ...(Array.isArray(patch.targetRoles) ? { targetRoles: patch.targetRoles } : {}),
      ...(Array.isArray(patch.keywords) ? { keywords: patch.keywords } : {}),
      ...(Array.isArray(patch.answers) ? { answers: patch.answers } : {}),
    }
    return this.profile.setTracks(p.tracks.map((t) => (t.id === id ? next : t)))
  }

  /**
   * Deletes a track and its resume file. Deleting the only track goes back to a
   * single implicit track, and its resume stays as the profile's resume.
   */
  delete(id: string): Profile {
    const p = this.profile.get()
    const gone = this.find(p, id)
    const rest = p.tracks.filter((t) => t.id !== id)
    if (!rest.length) return this.profile.setTracks([], gone.resume)
    const next = this.profile.setTracks(rest)
    const path = gone.resume?.storedPath
    if (path && !referenced(next, path)) removeStoredFile(this.resumesDir, path)
    return next
  }

  reorder(ids: string[]): Profile {
    const p = this.profile.get()
    const pos = new Map(ids.map((id, i) => [id, i]))
    const sorted = p.tracks
      .map((t, i) => ({ t, k: pos.get(t.id) ?? ids.length + i }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.t)
    return this.profile.setTracks(sorted)
  }

  setDefault(id: string): Profile {
    const p = this.profile.get()
    const t = this.find(p, id)
    return this.profile.setTracks([t, ...p.tracks.filter((x) => x.id !== id)])
  }

  /** Where a resume for `trackId` goes; null means the default track (or the profile, with no tracks). */
  target(trackId: string | null): ResumeTarget {
    const p = this.profile.get()
    const id = trackId ?? p.tracks[0]?.id ?? null
    if (id === null) return { prefix: '', current: () => this.profile.get().resume, set: (r) => this.profile.setResume(r) }
    this.find(p, id)
    return {
      prefix: filePrefix(id),
      current: () => this.profile.get().tracks.find((t) => t.id === id)?.resume ?? null,
      set: (r) => this.profile.setTrackResume(id, r),
    }
  }

  async importResume(trackId: string | null, fileName: string, data: Uint8Array): Promise<ResumeImport> {
    return importResume(this.target(trackId), this.resumesDir, fileName, data)
  }

  /** Clears the resume of a track (null: the default track, or the profile's) and deletes its file. */
  removeResume(trackId: string | null): Profile {
    const target = this.target(trackId)
    const old: StoredResume | null = target.current()
    const p = target.set(null)
    if (old?.storedPath && !referenced(p, old.storedPath)) removeStoredFile(this.resumesDir, old.storedPath)
    return p
  }
}

/** True when the profile or any track still points at this file. */
function referenced(p: Profile, path: string): boolean {
  return p.resume?.storedPath === path || p.tracks.some((t) => t.resume?.storedPath === path)
}
