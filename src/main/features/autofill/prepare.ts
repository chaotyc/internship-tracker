/**
 * What a fill uses for one role: the profile with the role's track answers in
 * front, and the track's resume. Pure, so track selection is covered by tests.
 */
import { DEFAULT_TRACK_ID, type Profile, type StoredResume } from '@shared/profile'
import type { Role } from '@shared/roles'
import type { ProfileService } from '../profile/service'
import { similarity } from './match'

export interface FillInputs {
  profile: Profile
  /** The role's track resume, else the profile's resume (ProfileService.resumeFor). */
  resume: StoredResume | null
  /** The track's name when the resume is that track's own (not the profile's fallback). */
  resumeTrack: string | null
}

/** A track answer replaces a profile answer to the same question. */
const SAME_QUESTION = 0.85

export function prepareFill(profiles: Pick<ProfileService, 'get' | 'trackFor' | 'resumeFor'>, role: Pick<Role, 'trackId'>): FillInputs {
  const profile = profiles.get()
  const track = profiles.trackFor(role.trackId)
  const trackAnswers = track.answers.filter((a) => a.question.trim() && a.answer.trim())
  const answers = [
    ...trackAnswers,
    ...profile.answers.filter((a) => !trackAnswers.some((t) => similarity(t.question, a.question) >= SAME_QUESTION)),
  ]
  const resume = profiles.resumeFor(role.trackId)
  const own = track.id !== DEFAULT_TRACK_ID && !!resume && !!track.resume && track.resume.storedPath === resume.storedPath
  return { profile: { ...profile, answers }, resume, resumeTrack: own ? track.name : null }
}
