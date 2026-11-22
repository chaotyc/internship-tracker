import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile } from '@shared/profile'
import type { EncryptedProfileService } from './service'
import type { TrackManager } from './tracks'

/** A clearly fictional applicant for screenshots. Only used with TRACKER_DEMO=1. */
export const DEMO_PROFILE: Profile = {
  tracks: [],
  legalFirstName: 'Alexandra',
  legalLastName: 'Rivera',
  preferredName: 'Alex',
  email: 'alex@example.com',
  phone: '+1 555 010 0199',
  city: 'Berkeley',
  region: 'CA',
  country: 'United States',
  linkedin: 'https://linkedin.com/in/alex-rivera-example',
  github: 'https://github.com/alex-rivera-example',
  website: 'https://alexrivera.example.com',
  scholar: '',
  education: [
    { school: 'Example State University', degree: 'B.S.', field: 'Electrical Engineering and Computer Science', startDate: '2024-08', endDate: '2028-05', gpa: '3.8/4.0' },
  ],
  authorizedToWorkUS: true,
  needsSponsorship: false,
  demographics: { gender: '', pronouns: 'they/them', hispanicLatino: 'decline', race: '', veteran: '', disability: '' },
  preferences: {
    targetRoles: ['ML inference intern', 'GPU kernels intern', 'Photonics intern'],
    locations: ['San Francisco Bay Area', 'Seattle, WA'],
    remoteOk: true,
    term: 'Summer 2027',
    minPay: '$40/hr',
    keywords: ['CUDA', 'PyTorch', 'compilers'],
    excludeKeywords: ['sales'],
    notes: 'Prefer teams that ship to production. Open to a fall co-op.',
  },
  answers: [
    { id: 'demo-1', question: 'How did you hear about us?', answer: 'Company careers page' },
    { id: 'demo-2', question: 'Earliest start date', answer: 'May 26, 2027' },
  ],
  resume: null,
}

const DEMO_RESUME = `Alex Rivera
alex@example.com · Berkeley, CA · github.com/alex-rivera-example

EDUCATION
Example State University, B.S. Electrical Engineering and Computer Science, expected May 2028. GPA 3.8/4.0

EXPERIENCE
Research Assistant, Example Systems Lab (Jan 2026 to present)
- Wrote fused attention kernels in CUDA; 1.7x faster decode on a 7B model.
- Built a benchmark harness for batch-size sweeps across three GPU generations.

PROJECTS
Tiny inference server: continuous batching and paged KV cache in 2,000 lines of Python.

SKILLS
CUDA, PyTorch, C++, Python, Triton, Linux`

const PHOTONICS_RESUME = `Alex Rivera
alex@example.com · Berkeley, CA · github.com/alex-rivera-example

EDUCATION
Example State University, B.S. Electrical Engineering and Computer Science, expected May 2028. GPA 3.8/4.0
Coursework: Electromagnetics, Optoelectronics, Analog Circuits, Signals and Systems

EXPERIENCE
Undergraduate Researcher, Example Photonics Lab (Jun 2025 to present)
- Characterized silicon ring resonators on a fiber-coupled probe station; automated sweeps in Python.
- Built a temperature-controlled test fixture that cut wavelength drift during measurements by half.

PROJECTS
Free-space optical link: 1 Gb/s over 10 m with an off-the-shelf laser diode and a custom TIA board.

SKILLS
Lumerical, KiCad, Python, MATLAB, lab instruments (OSA, oscilloscopes, lasers), soldering`

export const DEMO_TRACK_ML = 'demo-ml'
export const DEMO_TRACK_PHOTONICS = 'demo-photonics'

/** Companies whose demo roles go on the photonics track. */
const PHOTONICS_COMPANIES = new Set(['Lumora Photonics', 'Prism Labs', 'Quanta Optics Lab'])

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function writeDemoResume(service: EncryptedProfileService, resumesDir: string, trackId: string, fileName: string, text: string, age: number): void {
  const storedPath = join(resumesDir, `${trackId}-${fileName}`)
  writeFileSync(storedPath, text)
  service.setTrackResume(trackId, { fileName, storedPath, text, updatedAt: daysAgo(age) })
}

/** Seeds the in-memory demo database. Resume copies go to the demo folder, never the real one. */
export function seedDemoProfile(service: EncryptedProfileService, tracks: TrackManager, resumesDir: string): void {
  service.save(DEMO_PROFILE)
  mkdirSync(resumesDir, { recursive: true })
  tracks.create('ML inference', DEMO_TRACK_ML)
  tracks.update(DEMO_TRACK_ML, {
    description: 'Inference runtimes, GPU kernels and compilers.',
    targetRoles: ['ML inference intern', 'GPU kernels intern'],
    keywords: ['CUDA', 'PyTorch', 'Triton', 'compilers'],
  })
  writeDemoResume(service, resumesDir, DEMO_TRACK_ML, 'Alex_Rivera_Resume.txt', DEMO_RESUME, 2)
  tracks.create('Photonics hardware', DEMO_TRACK_PHOTONICS)
  tracks.update(DEMO_TRACK_PHOTONICS, {
    description: 'Silicon photonics, optical I/O and lab hardware.',
    targetRoles: ['Photonics intern', 'Optical engineering intern'],
    keywords: ['silicon photonics', 'optics', 'Lumerical', 'lab'],
    answers: [
      { id: 'demo-p1', question: 'Why are you interested in this role?', answer: 'I have spent the last year measuring ring resonators in a photonics lab and want to see the same devices go into a product.' },
    ],
  })
  writeDemoResume(service, resumesDir, DEMO_TRACK_PHOTONICS, 'Alex_Rivera_Photonics.txt', PHOTONICS_RESUME, 9)
}

/**
 * Puts the demo's photonics roles on the photonics track. Returns false while the
 * roles haven't been seeded yet, so the caller can try again later.
 */
export function assignDemoTracks(
  roles: { list(): { id: string; company: string; trackId: string }[]; update(id: string, patch: { trackId: string }): unknown } | undefined,
  service: EncryptedProfileService,
): boolean {
  if (!roles?.list || !roles.update) return false
  if (!service.get().tracks.some((t) => t.id === DEMO_TRACK_PHOTONICS)) return true
  const list = roles.list()
  if (!list.length) return false
  for (const r of list) if (PHOTONICS_COMPANIES.has(r.company) && r.trackId !== DEMO_TRACK_PHOTONICS) roles.update(r.id, { trackId: DEMO_TRACK_PHOTONICS })
  return true
}
