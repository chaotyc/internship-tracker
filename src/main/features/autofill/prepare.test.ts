import { describe, expect, it } from 'vitest'
import { defaultTrack, type ApplicationTrack, type Profile, type StoredResume } from '@shared/profile'
import type { ProfileService } from '../profile/service'
import { testProfile } from './fixtures'
import { savedAnswerIntent } from './match'
import { prepareFill } from './prepare'

const resume = (fileName: string): StoredResume => ({ fileName, storedPath: `/data/resumes/${fileName}`, text: '', updatedAt: '2026-11-01T00:00:00Z' })

const track = (over: Partial<ApplicationTrack> & Pick<ApplicationTrack, 'id' | 'name'>): ApplicationTrack => ({
  description: '',
  resume: null,
  targetRoles: [],
  keywords: [],
  answers: [],
  ...over,
})

/** Same contract as EncryptedProfileService: trackFor falls back to the first track, resumeFor to the profile's resume. */
function service(profile: Profile): Pick<ProfileService, 'get' | 'trackFor' | 'resumeFor'> & { asked: string[] } {
  const asked: string[] = []
  const tracks = () => (profile.tracks.length ? profile.tracks : [defaultTrack(profile)])
  const trackFor = (id: string) => tracks().find((t) => t.id === id) ?? tracks()[0]!
  return {
    asked,
    get: () => profile,
    trackFor,
    resumeFor(id) {
      asked.push(id)
      return trackFor(id).resume ?? profile.resume
    },
  }
}

describe('resume selection by track', () => {
  const profile = testProfile({
    resume: resume('Test_User_General.pdf'),
    tracks: [
      track({ id: 'ml', name: 'ML inference', resume: resume('Test_User_ML.pdf') }),
      track({ id: 'hw', name: 'Photonics hardware', resume: resume('Test_User_Photonics.pdf') }),
      track({ id: 'pm', name: 'Product', resume: null }),
    ],
  })

  it("attaches the role's track resume, asking the profile service for that track", () => {
    const s = service(profile)
    const r = prepareFill(s, { trackId: 'hw' })
    expect(s.asked).toEqual(['hw'])
    expect(r.resume?.fileName).toBe('Test_User_Photonics.pdf')
    expect(r.resumeTrack).toBe('Photonics hardware')
    expect(prepareFill(service(profile), { trackId: 'ml' }).resume?.fileName).toBe('Test_User_ML.pdf')
  })

  it("falls back to the profile's resume when the track has none", () => {
    const r = prepareFill(service(profile), { trackId: 'pm' })
    expect(r.resume?.fileName).toBe('Test_User_General.pdf')
    expect(r.resumeTrack).toBeNull()
  })

  it('uses the profile resume for roles on the default track', () => {
    const plain = testProfile({ resume: resume('Test_User.pdf') })
    const r = prepareFill(service(plain), { trackId: '' })
    expect(r.resume?.fileName).toBe('Test_User.pdf')
    expect(r.resumeTrack).toBeNull()
  })

  it('has no resume when neither the track nor the profile has one', () => {
    expect(prepareFill(service(testProfile()), { trackId: '' }).resume).toBeNull()
  })
})

describe('track answers', () => {
  it("put the track's answer ahead of the profile's answer to the same question", () => {
    const profile = testProfile({
      answers: [
        { id: 'p1', question: 'Why are you interested in this role?', answer: 'General answer' },
        { id: 'p2', question: 'SAT score', answer: '1540' },
      ],
      tracks: [track({ id: 'ml', name: 'ML', answers: [{ id: 't1', question: 'Why are you interested in this role?', answer: 'ML answer' }] })],
    })
    const { profile: p } = prepareFill(service(profile), { trackId: 'ml' })
    expect(p.answers.map((a) => a.id)).toEqual(['t1', 'p2'])
    expect(savedAnswerIntent('Why are you interested in this role?', p)?.text).toBe('ML answer')
    expect(savedAnswerIntent('SAT score', p)?.text).toBe('1540')
  })
})
