import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile } from '@shared/profile'
import type { EncryptedProfileService } from './service'

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

/** Seeds the in-memory demo database. The resume copy goes to the demo folder, never the real one. */
export function seedDemoProfile(service: EncryptedProfileService, resumesDir: string): void {
  service.save(DEMO_PROFILE)
  mkdirSync(resumesDir, { recursive: true })
  const storedPath = join(resumesDir, 'Alex_Rivera_Resume.txt')
  writeFileSync(storedPath, DEMO_RESUME)
  service.setResume({
    fileName: 'Alex_Rivera_Resume.txt',
    storedPath,
    text: DEMO_RESUME,
    updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  })
}
