import { describe, expect, it } from 'vitest'
import type { Role, StageKey } from '@shared/roles'
import { buildProposalRequest, parseAiProposal } from './ai'
import { htmlToText, looksLikeRfc822, parseEmail, trimBody } from './email'
import { compactName, domainMatchesCompany, headerCandidates, matchEmail, mentionsCompany } from './match'
import { extractDate, ruleProposal, stageChange } from './rules'

let n = 0
export function role(company: string, title = 'Software Engineering Intern', stage: StageKey = 'applied', extra: Partial<Role> = {}): Role {
  return {
    id: `role-${++n}`, company, title, stage, link: '', location: '', pay: '', deadline: '', fit: '', priority: '', why: '', watch: '', notes: '',
    postingStatus: '', appliedOn: '', source: 'manual', trackId: '', nextStep: null, liveness: { status: 'unknown', checkedAt: null, detail: '' },
    order: 0, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...extra,
  }
}

const EML = [
  'From: "Vectorline Recruiting" <no-reply@ashbyhq.com>',
  'To: student@example.com',
  'Subject: =?UTF-8?Q?Next_step=3A_Vectorline_assessment?=',
  'Date: Thu, 19 Nov 2026 10:15:00 -0800',
  'Message-ID: <abc123@ashbyhq.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hi Alex,=0A',
  'Thanks for applying to Vectorline! Please complete the CodeSignal assessment by No=',
  'vember 26.',
  '',
  '--b1',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Hi Alex</p>',
  '--b1--',
  '',
].join('\r\n')

describe('parseEmail', () => {
  it('parses a .eml: decoded subject, sender, date, plain text and Message-ID', async () => {
    expect(looksLikeRfc822(EML)).toBe(true)
    const e = await parseEmail(EML)
    expect(e.subject).toBe('Next step: Vectorline assessment')
    expect(e.from).toEqual({ name: 'Vectorline Recruiting', address: 'no-reply@ashbyhq.com' })
    expect(e.date).toBe('2026-11-19T18:15:00.000Z')
    expect(e.text).toContain('assessment by November 26.')
    expect(e.key).toBe('msg:<abc123@ashbyhq.com>')
  })

  it('reads text copied out of a mail app', async () => {
    const pasted = 'Your Granitecore interview\nInbox\n\nGranitecore Recruiting <talent@granitecore.com>\nTue, Nov 18, 2:14 PM\nto me\n\nHi! Can we do a phone screen on Monday at 2pm?'
    expect(looksLikeRfc822(pasted)).toBe(false)
    const e = await parseEmail(pasted)
    expect(e.from).toEqual({ name: 'Granitecore Recruiting', address: 'talent@granitecore.com' })
    expect(e.subject).toBe('Your Granitecore interview')
    expect(e.key).toMatch(/^hash:/)
    expect((await parseEmail(pasted + '  ')).key).toBe(e.key)
  })

  it('turns HTML into text and trims quoted replies and long links', () => {
    expect(htmlToText('<style>x{}</style><p>Hello&nbsp;there &amp; <b>you</b></p><ul><li>One</li></ul>')).toBe('Hello there & you\n• One')
    const body = 'Thanks!\nSee https://app.greenhouse.io/x?token=SECRET\n\nOn Tue, Nov 18, 2026 at 2:14 PM Someone wrote:\n> old stuff'
    expect(trimBody(body)).toBe('Thanks!\nSee [link: app.greenhouse.io]')
  })
})

describe('matching an email to a role', () => {
  const vectorline = role('Vectorline', 'Inference Intern')
  const meta = role('Kite', 'Software Engineering Intern')
  const together = role('Cobaltine AI', 'Research Intern, Inference', 'interviewing')
  const kestrelA = role('Kestrel', 'AI Compiler and Kernel Intern', 'saved')
  const kestrelB = role('Kestrel', 'Deep Learning Performance Intern', 'applied')
  const roles = [vectorline, meta, together, kestrelA, kestrelB]
  const email = (from: { name: string; address: string }, subject: string, text = '') => ({ from, subject, text })

  it('knows a company by its own domain', () => {
    expect(compactName('Cobaltine AI, Inc.')).toBe('cobaltineai')
    expect(domainMatchesCompany('vectorline.com', vectorline)).toBe(true)
    expect(domainMatchesCompany('mail.vectorline.com', vectorline)).toBe(true)
    expect(domainMatchesCompany('kitecareers.com', meta)).toBe(true)
    expect(domainMatchesCompany('cobaltine.ai', together)).toBe(true)
    expect(domainMatchesCompany('metal.com', meta)).toBe(false)
    expect(domainMatchesCompany('gmail.com', meta)).toBe(false)
  })

  it('matches names as whole words only', () => {
    expect(mentionsCompany('Your Kite application', 'Kite')).toBe(true)
    expect(mentionsCompany('metadata export ready', 'Kite')).toBe(false)
    expect(mentionsCompany('Thanks from COBALTINE  AI', 'Cobaltine AI')).toBe(true)
  })

  it('uses ATS senders only together with the company name', () => {
    expect(matchEmail(email({ name: 'Vectorline', address: 'no-reply@ashbyhq.com' }, 'Thanks for applying'), roles)?.role).toBe(vectorline)
    expect(matchEmail(email({ name: 'Hiring Team', address: 'no-reply@us.greenhouse-mail.io' }, 'Thank you for applying', 'Thanks for applying to Cobaltine AI.'), roles)?.role).toBe(together)
    expect(matchEmail(email({ name: '', address: 'kestrel@myworkday.com' }, 'Application received'), roles)?.role.company).toBe('Kestrel')
    // An ATS email for a company that isn't on the board matches nothing.
    expect(matchEmail(email({ name: 'Acme', address: 'no-reply@hire.lever.co' }, 'Thanks for applying to Acme'), roles)).toBeNull()
  })

  it('picks between roles at the same company by title words', () => {
    const m = matchEmail(email({ name: 'Kestrel Recruiting', address: 'jobs@kestrel.com' }, 'Your Deep Learning Performance application'), roles)
    expect(m?.role).toBe(kestrelB)
    expect(m?.confidence).toBe('strong')
  })

  it('ignores newsletters that only mention a company in the body, unless pasted on purpose', () => {
    const news = email({ name: 'Tech Digest', address: 'news@digest.example' }, 'This week in chips', 'Kestrel is hiring interns again; Kite posted a new role.')
    expect(matchEmail(news, roles)).toBeNull()
    expect(matchEmail(news, roles, { lenient: true })).not.toBeNull()
  })

  it('pre-filters on headers alone', () => {
    expect(headerCandidates({ from: { name: 'Vectorline Recruiting', address: 'x@ashbyhq.com' }, subject: 'Hi' }, roles)).toEqual([vectorline])
    expect(headerCandidates({ from: { name: 'Mom', address: 'mom@gmail.com' }, subject: 'Dinner Sunday?' }, roles)).toEqual([])
    expect(headerCandidates({ from: { name: 'Team', address: 'x@greenhouse-mail.io' }, subject: 'Thanks for applying' }, roles)).toEqual([])
    expect(headerCandidates({ from: { name: 'Jo', address: 'jo@gmail.com' }, subject: 'Kite interview prep group' }, roles)).toEqual([meta])
  })
})

describe('rule-based proposals', () => {
  const REF = '2026-11-19' // Thursday

  it('finds dates and times in many forms, first upcoming one wins', () => {
    expect(extractDate('Please finish by November 26.', REF)).toEqual({ due: '2026-11-26', time: '' })
    expect(extractDate('You applied Nov 3. Interview Tue, Dec 1 at 2:30 PM PT', REF)).toEqual({ due: '2026-12-01', time: '14:30' })
    expect(extractDate('Can you do 11/24 at 10am?', REF)).toEqual({ due: '2026-11-24', time: '10:00' })
    expect(extractDate('Complete it within 7 days', REF)).toEqual({ due: '2026-11-26', time: '' })
    expect(extractDate('within 48 hours', REF)).toEqual({ due: '2026-11-21', time: '' })
    expect(extractDate('Are you free on Monday?', REF)).toEqual({ due: '2026-11-23', time: '' })
    expect(extractDate('Start date January 12', REF)).toEqual({ due: '2027-01-12', time: '' })
    expect(extractDate('Talk to you 2026-12-03 at 16:00', REF)).toEqual({ due: '2026-12-03', time: '16:00' })
    expect(extractDate('No dates here.', REF)).toBeNull()
  })

  it('reads a rejection', () => {
    const p = ruleProposal({ subject: 'Your application', text: 'Unfortunately, we will not be moving forward.', date: '' }, { company: 'Kite', stage: 'applied' }, REF)
    expect(p).toEqual({ summary: "Kite isn't moving forward with your application.", stage: 'rejected', nextStep: null })
  })

  it('reads an assessment with a due date', () => {
    const p = ruleProposal({ subject: 'Vectorline assessment', text: 'Please complete the CodeSignal assessment within 5 days.', date: '2026-11-19T18:00:00Z' }, { company: 'Vectorline', stage: 'applied' }, '2026-11-21')
    expect(p).toMatchObject({ stage: 'interviewing', nextStep: { text: 'Complete the online assessment', due: '2026-11-24' } })
  })

  it('reads interview scheduling and a set interview', () => {
    expect(ruleProposal({ subject: 'Next steps', text: 'We would like to schedule a phone screen. Please share your availability.', date: '' }, { company: 'Tessellate', stage: 'applied' }, REF))
      .toMatchObject({ stage: 'interviewing', nextStep: { text: 'Reply with your availability for the phone screen', due: '' } })
    expect(ruleProposal({ subject: 'Interview confirmed', text: 'Your interview is confirmed for Dec 2 at 11:00 AM.', date: '' }, { company: 'Tessellate', stage: 'interviewing' }, REF))
      .toEqual({ summary: 'Tessellate set up an interview on 2026-12-02.', stage: null, nextStep: { text: 'Interview with Tessellate', due: '2026-12-02', time: '11:00' } })
  })

  it('moves a saved role to Applied on a confirmation, and otherwise proposes nothing', () => {
    expect(ruleProposal({ subject: 'Thank you for applying!', text: 'We received your application.', date: '' }, { company: 'Halcyon', stage: 'saved' }, REF)?.stage).toBe('applied')
    expect(ruleProposal({ subject: 'Thank you for applying!', text: 'We received your application.', date: '' }, { company: 'Halcyon', stage: 'applied' }, REF)).toBeNull()
    expect(ruleProposal({ subject: 'Newsletter', text: 'Hello', date: '' }, { company: 'Halcyon', stage: 'applied' }, REF)).toBeNull()
  })

  it('only moves forward', () => {
    expect(stageChange('offer', 'interviewing')).toBeNull()
    expect(stageChange('applied', 'interviewing')).toBe('interviewing')
    expect(stageChange('rejected', 'interviewing')).toBeNull()
    expect(stageChange('interviewing', 'rejected')).toBe('rejected')
  })
})

describe('AI proposals', () => {
  it('sends only the matched role and the email, never the profile or other roles', async () => {
    const e = await parseEmail(EML)
    const req = buildProposalRequest(e, role('Vectorline', 'Inference Intern', 'applied', { notes: 'PRIVATE_NOTE', pay: '$99/hr' }), '2026-11-21')
    const all = JSON.stringify(req)
    expect(all).toContain('Vectorline')
    expect(all).toContain('Inference Intern')
    expect(all).toContain('CodeSignal assessment')
    expect(all).not.toContain('PRIVATE_NOTE')
    expect(all).not.toContain('$99/hr')
    expect(req.json).toBe(true)
    expect(req.messages).toHaveLength(1)
  })

  it('parses and validates the reply', () => {
    expect(parseAiProposal({ summary: ' Invited to an  assessment ', stage: 'Interviewing', nextStep: { text: 'Do the OA', due: '2026-11-26', time: '9:05' } }, { stage: 'applied' })).toEqual({
      summary: 'Invited to an assessment',
      stage: 'interviewing',
      nextStep: { text: 'Do the OA', due: '2026-11-26', time: '09:05' },
    })
    // Backwards stage, bad date and missing time are dropped; the step survives.
    expect(parseAiProposal({ summary: 's', stage: 'applied', nextStep: { text: 'Reply', due: 'Friday', time: '10:00' } }, { stage: 'interviewing' })).toEqual({
      summary: 's',
      stage: null,
      nextStep: { text: 'Reply', due: '', time: '' },
    })
    expect(parseAiProposal({ summary: 'Rejected', stage: 'rejected', nextStep: null }, { stage: 'applied' })).toEqual({ summary: 'Rejected', stage: 'rejected', nextStep: null })
    expect(() => parseAiProposal('not json', { stage: 'applied' })).toThrow()
    expect(() => parseAiProposal({}, { stage: 'applied' })).toThrow()
  })
})
