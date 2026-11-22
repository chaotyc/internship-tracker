import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE, type Profile } from '@shared/profile'
import type { ChatMessage } from '@shared/chat'
import type { Role } from '@shared/roles'
import { boardSection, buildSystemPrompt, historyForModel } from './prompt'

const profile: Profile = {
  ...structuredClone(EMPTY_PROFILE),
  legalFirstName: 'Sam',
  legalLastName: 'Example',
  email: 'sam@example.invalid',
  phone: '555-0100',
  github: 'https://github.com/example',
  education: [{ school: 'Example University', degree: 'BS', field: 'Physics', startDate: '2024', endDate: '2028', gpa: '3.9' }],
  authorizedToWorkUS: true,
  needsSponsorship: false,
  demographics: {
    gender: 'DEMO_GENDER_MARKER',
    pronouns: 'DEMO_PRONOUNS_MARKER',
    hispanicLatino: 'DEMO_HISPANIC_MARKER',
    race: 'DEMO_RACE_MARKER',
    veteran: 'DEMO_VETERAN_MARKER',
    disability: 'DEMO_DISABILITY_MARKER',
  },
  preferences: { ...EMPTY_PROFILE.preferences, targetRoles: ['ML inference intern'], term: 'Summer 2027' },
  answers: [{ id: '1', question: 'How did you hear about us?', answer: 'A friend' }],
  resume: { fileName: 'r.pdf', storedPath: '/x', text: 'Built a   KV-cache\n\n\n\nscheduler. ' + 'x'.repeat(20_000), updatedAt: '' },
}

const role = (over: Partial<Role>): Role => ({
  id: 'abcdef12-3456-4000-8000-000000000000',
  company: 'Vectorline',
  title: 'Inference Intern',
  stage: 'saved',
  link: 'https://jobs.example/1',
  location: 'San Jose',
  pay: '',
  deadline: '2026-12-01',
  fit: 'Strong',
  priority: '',
  why: 'Transformer ASICs',
  watch: '',
  notes: 'Referral from a TA',
  postingStatus: '',
  appliedOn: '',
  source: 'manual',
  liveness: { status: 'unknown', checkedAt: null, detail: '' },
  order: 0,
  createdAt: '',
  updatedAt: '',
  ...over,
})

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt({ profile, roles: [role({})], openRole: role({}), now: new Date(2026, 10, 21, 9) })

  it('never includes demographics, email or phone', () => {
    expect(prompt).not.toMatch(/MARKER/)
    expect(prompt).not.toMatch(/gender|pronoun|race|veteran|disabilit|hispanic/i)
    expect(prompt).not.toContain('sam@example.invalid')
    expect(prompt).not.toContain('555-0100')
  })

  it('includes the date, profile, preferences, answers, resume, board and open role', () => {
    expect(prompt).toContain('Saturday, November 21, 2026 (2026-11-21)')
    expect(prompt).toContain('Name: Sam Example')
    expect(prompt).toContain('BS in Physics, Example University (2024 – 2028), GPA 3.9')
    expect(prompt).toContain('GitHub https://github.com/example')
    expect(prompt).toContain('Needs visa sponsorship: no')
    expect(prompt).toContain('Target roles: ML inference intern')
    expect(prompt).toContain('A: A friend')
    expect(prompt).toContain('Built a KV-cache\n\nscheduler.')
    expect(prompt).toContain('[abcdef12] Vectorline — Inference Intern | Saved | fit Strong | deadline 2026-12-01')
    expect(prompt).toContain('Notes: Referral from a TA')
    expect(prompt).toContain('```action')
    expect(prompt).toMatch(/Never say or imply a change is made.*until the user has applied it/)
  })

  it('trims a long resume', () => {
    const resume = prompt.split('## Resume (text)\n')[1]!.split('\n\n## ')[0]!
    expect(resume.length).toBeLessThanOrEqual(12_000)
  })

  it('caps the board summary', () => {
    const many = Array.from({ length: 100 }, (_, i) => role({ id: `id${String(i).padStart(6, '0')}`, company: `Co ${i}` }))
    const lines = boardSection(many).split('\n')
    expect(lines).toHaveLength(81)
    expect(lines.at(-1)).toContain('20 more')
  })

  it('says when there is no resume', () => {
    expect(buildSystemPrompt({ profile: EMPTY_PROFILE, roles: [], openRole: null })).toContain('No resume on file')
  })
})

describe('historyForModel', () => {
  const msg = (i: number, role: ChatMessage['role'], content = `m${i}`): ChatMessage => ({
    id: String(i),
    role,
    content,
    createdAt: '',
    roleId: null,
    actions: [],
  })

  it('keeps the last 30, starting with a user turn', () => {
    const all = Array.from({ length: 50 }, (_, i) => msg(i, i % 2 ? 'assistant' : 'user'))
    const out = historyForModel(all)
    expect(out[0]!.role).toBe('user')
    expect(out.length).toBeLessThanOrEqual(30)
    expect(out.at(-1)!.content).toBe('m49')
    expect(out[0]!.content).toBe('m20')
  })

  it('merges consecutive turns from the same speaker (e.g. after a failed send)', () => {
    const out = historyForModel([msg(1, 'user', 'first'), msg(2, 'user', 'second')])
    expect(out).toEqual([{ role: 'user', content: 'first\n\nsecond' }])
  })

  it('drops the oldest messages past the size cap', () => {
    const big = 'x'.repeat(400)
    const out = historyForModel([msg(1, 'user', big), msg(2, 'assistant', big), msg(3, 'user', 'latest')], 30, 500)
    expect(out).toEqual([{ role: 'user', content: 'latest' }])
  })

  it('tells the model what happened to its proposals', () => {
    const a: ChatMessage = { ...msg(2, 'assistant', 'ok'), actions: [{ action: { kind: 'save_answers', answers: [{ question: 'q', answer: 'a' }] }, state: 'applied' }] }
    expect(historyForModel([msg(1, 'user'), a])[1]!.content).toContain('save 1 answer(s): applied')
  })
})
