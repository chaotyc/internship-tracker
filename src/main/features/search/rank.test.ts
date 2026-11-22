import { describe, expect, it, vi } from 'vitest'
import { EMPTY_PROFILE, type ApplicationTrack, type Profile } from '@shared/profile'
import type { AiService } from '../ai/service'
import { posting } from './fixtures/mockFetch'
import { bestTrackByKeywords, prefsForAllTracks, rankPrompt, rankWithAi } from './rank'

const track = (id: string, name: string, keywords: string[], resume = ''): ApplicationTrack => ({
  id,
  name,
  description: '',
  resume: resume ? { fileName: `${id}.pdf`, storedPath: `/x/${id}.pdf`, text: resume, updatedAt: '' } : null,
  targetRoles: [],
  keywords,
  answers: [],
})

const ML = track('ml', 'ML inference', ['CUDA', 'inference'], 'Wrote CUDA kernels for LLM inference.')
const PHOTONICS = track('ph', 'Photonics hardware', ['photonics', 'laser'], 'Built a laser characterization bench.')
const profile: Profile = { ...EMPTY_PROFILE, email: 'me@example.com', preferences: { ...EMPTY_PROFILE.preferences, term: 'Summer 2027' }, tracks: [ML, PHOTONICS] }

const noAi = {
  complete: async () => {
    throw new Error('No AI connection is set up yet.')
  },
  json: async () => {
    throw new Error('No AI connection is set up yet.')
  },
  status: async () => [],
} as unknown as AiService

describe('per-track ranking', () => {
  it('keyword fallback picks the track whose keywords the posting matches', () => {
    const p = posting({ title: 'Photonics Test Intern', description: 'Align lasers on a photonics bench.' })
    const q = posting({ title: 'Inference Intern', description: 'CUDA kernels.' })
    expect(bestTrackByKeywords(p, profile.preferences, [ML, PHOTONICS]).trackId).toBe('ph')
    expect(bestTrackByKeywords(q, profile.preferences, [ML, PHOTONICS]).trackId).toBe('ml')
  })

  it('the filter accepts keywords from any track', () => {
    expect(prefsForAllTracks(profile.preferences, [ML, PHOTONICS]).keywords).toEqual(['CUDA', 'inference', 'photonics', 'laser'])
  })

  it('sends each track, recent dismissals and the requirements section, not the first 500 characters', () => {
    const blurb = 'At Acme, we build optical engines for the world. '.repeat(20)
    const p = posting({ company: 'Acme', title: 'Laser Intern', description: `${blurb}\nRequirements\n• Hands-on laser alignment and fiber coupling experience` })
    const prompt = rankPrompt([{ posting: p, score: 50, reason: '' }], profile, [ML, PHOTONICS], [{ title: 'Sales Intern', company: 'Bigco' }])
    expect(prompt).toContain('Track "ml" — ML inference')
    expect(prompt).toContain('Wrote CUDA kernels')
    expect(prompt).toContain('Track "ph" — Photonics hardware')
    expect(prompt).toContain('Built a laser characterization bench')
    expect(prompt).toContain('Requirements: Requirements\n• Hands-on laser alignment')
    expect(prompt).not.toContain('we build optical engines')
    expect(prompt).toContain('Recently dismissed (not interested):\n- Sales Intern at Bigco')
    expect(prompt).not.toContain('me@example.com')
  })

  it('records the track the AI picks, and falls back to the keyword track when it names none or a bad one', async () => {
    const a = posting({ title: 'Laser Intern' })
    const b = posting({ title: 'Kernel Intern' })
    const json = vi.fn(async () => ({
      ranked: [
        { i: 0, track: 'ph', score: 88, reason: 'Laser bench work.' },
        { i: 1, track: 'nope', score: 70, reason: 'Kernels.' },
      ],
    }))
    const res = await rankWithAi(
      [
        { posting: a, score: 50, reason: '', trackId: 'ml' } as never,
        { posting: b, score: 50, reason: '', trackId: 'ml' } as never,
      ],
      profile,
      { ...noAi, json: json as AiService['json'] },
      new AbortController().signal,
      [ML, PHOTONICS],
    )
    expect('ranked' in res && res.ranked.map((r) => [r.posting.title, r.trackId])).toEqual([
      ['Laser Intern', 'ph'],
      ['Kernel Intern', 'ml'],
    ])
  })
})
