import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }))

import type { AiRequest, ProviderStatus } from '@shared/ai'
import { openStore } from '../../db/store'
import { RolesService, rolesMigrations } from '../roles/service'
import { checkInbox, type HeaderSummary, type MailClient } from './imap'
import { ProposalStore, applyProposal, dismissProposal, ingestEmail, ingestRaw, todayMigrations, type HookDeps } from './proposals'

const eml = (from: string, subject: string, body: string, id: string) =>
  [`From: ${from}`, 'To: me@example.com', `Subject: ${subject}`, 'Date: Thu, 19 Nov 2026 10:00:00 -0800', `Message-ID: <${id}>`, 'Content-Type: text/plain; charset=utf-8', '', body, ''].join('\r\n')

function fakeAi(reply: unknown = { summary: 'Assessment invite', stage: 'interviewing', nextStep: { text: 'Complete the assessment', due: '2026-11-26', time: '' } }, available = true) {
  const calls: AiRequest[] = []
  return {
    calls,
    ai: {
      status: async () => [{ id: 'anthropic-api', available } as ProviderStatus],
      json: async <T,>(req: AiRequest): Promise<T> => {
        calls.push(req)
        if (reply instanceof Error) throw reply
        return reply as T
      },
    },
  }
}

async function setup(ai = fakeAi()) {
  const store = await openStore(null)
  store.migrate([...rolesMigrations, ...todayMigrations])
  const roles = new RolesService(store, () => {})
  const vectorline = roles.create({ company: 'Vectorline', title: 'Inference Intern', stage: 'applied' })
  const meta = roles.create({ company: 'Kite', title: 'Software Engineering Intern', stage: 'applied' })
  const changed = vi.fn()
  const deps: HookDeps = { proposals: new ProposalStore(store), roles, ai: ai.ai, changed, today: () => '2026-11-21' }
  return { roles, vectorline, meta, deps, changed, calls: ai.calls }
}

describe('pasting an email', () => {
  it('matches the role, asks the AI with only that email, and stores a pending proposal', async () => {
    const { deps, vectorline, calls, changed, roles } = await setup()
    const res = await ingestRaw(eml('Vectorline Recruiting <jobs@vectorline.com>', 'Vectorline assessment', 'Please do the assessment.', 'a1'), deps)
    expect(res.kind).toBe('proposal')
    if (res.kind !== 'proposal') return
    expect(res.proposal).toMatchObject({ roleId: vectorline.id, status: 'pending', stage: 'interviewing', via: 'ai', origin: 'paste', email: { subject: 'Vectorline assessment' } })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.messages[0]!.content).toContain('Please do the assessment.')
    expect(changed).toHaveBeenCalled()
    // Nothing on the board changed yet.
    expect(roles.get(vectorline.id)!.stage).toBe('applied')
    expect(roles.get(vectorline.id)!.nextStep).toBeNull()
  })

  it('never sends an unmatched email to the AI', async () => {
    const { deps, calls } = await setup()
    const res = await ingestRaw(eml('Acme <jobs@acme.example>', 'Acme interview', 'Unfortunately the interview with Acme is off.', 'u1'), deps)
    expect(res).toEqual({ kind: 'unmatched', from: 'Acme <jobs@acme.example>', subject: 'Acme interview' })
    expect(calls).toHaveLength(0)
  })

  it('lets the user pick the role for an unmatched email', async () => {
    const { deps, meta } = await setup()
    const res = await ingestRaw('Hi, are you free for a chat on Monday about the internship?', deps, meta.id)
    expect(res.kind === 'proposal' && res.proposal.roleId).toBe(meta.id)
  })

  it('falls back to rules without AI, and says so', async () => {
    const { deps, calls } = await setup(fakeAi(undefined, false))
    const res = await ingestRaw(eml('Kite <recruiting@kite.com>', 'Update on your application', 'Unfortunately we will not be moving forward.', 'r1'), deps)
    expect(calls).toHaveLength(0)
    expect(res.kind === 'proposal' && res.proposal).toMatchObject({ via: 'rules', stage: 'rejected', note: expect.stringMatching(/No AI connection/) })
  })

  it('falls back to rules when the AI reply is unusable', async () => {
    const { deps } = await setup(fakeAi(new Error('timed out')))
    const res = await ingestRaw(eml('Kite <recruiting@kite.com>', 'Interview', 'We would like to schedule an interview. Share your availability.', 'r2'), deps)
    expect(res.kind === 'proposal' && res.proposal).toMatchObject({ via: 'rules', note: expect.stringMatching(/timed out/) })
  })

  it('spots duplicates and brings a dismissed one back when pasted again', async () => {
    const { deps } = await setup()
    const raw = eml('Vectorline <jobs@vectorline.com>', 'Vectorline assessment', 'Assessment inside.', 'd1')
    const first = await ingestRaw(raw, deps)
    if (first.kind !== 'proposal') throw new Error('expected a proposal')
    dismissProposal(first.proposal.id, deps)
    const again = await ingestRaw(raw, deps)
    expect(again).toMatchObject({ kind: 'duplicate', proposal: { id: first.proposal.id, status: 'pending' } })
  })

  it('reports when a matched email changes nothing', async () => {
    const { deps } = await setup(fakeAi(undefined, false))
    const res = await ingestRaw(eml('Kite <recruiting@kite.com>', 'Kite newsletter for candidates', 'Here is our blog.', 'n1'), deps)
    expect(res.kind).toBe('nothing')
  })
})

describe('applying and dismissing', () => {
  it('applies the stage and next step through the roles service, or only part of it', async () => {
    const { deps, vectorline, meta, roles } = await setup()
    const a = await ingestRaw(eml('Vectorline <jobs@vectorline.com>', 'Vectorline assessment', 'x', 'p1'), deps)
    if (a.kind !== 'proposal') throw new Error('expected a proposal')
    const applied = applyProposal(a.proposal.id, deps)
    expect(applied.status).toBe('applied')
    expect(roles.get(vectorline.id)).toMatchObject({ stage: 'interviewing', nextStep: { text: 'Complete the assessment', due: '2026-11-26', done: false, source: 'email' } })
    expect(() => applyProposal(a.proposal.id, deps)).toThrow(/already applied/)

    const b = await ingestRaw(eml('Kite <jobs@kite.com>', 'Kite assessment', 'x', 'p2'), deps)
    if (b.kind !== 'proposal') throw new Error('expected a proposal')
    applyProposal(b.proposal.id, deps, { stage: false })
    expect(roles.get(meta.id)).toMatchObject({ stage: 'applied', nextStep: { text: 'Complete the assessment' } })
    expect(deps.proposals.pending()).toEqual([])
  })

  it('dismisses without touching the board', async () => {
    const { deps, vectorline, roles } = await setup()
    const a = await ingestRaw(eml('Vectorline <jobs@vectorline.com>', 'Vectorline assessment', 'x', 'q1'), deps)
    if (a.kind !== 'proposal') throw new Error('expected a proposal')
    expect(dismissProposal(a.proposal.id, deps).status).toBe('dismissed')
    expect(roles.get(vectorline.id)!.stage).toBe('applied')
  })
})

/** An in-memory mailbox that records what was fetched. No network. */
function fakeClient(messages: (HeaderSummary & { raw: string })[], uidValidity = '7') {
  const fetched: number[] = []
  const calls: string[] = []
  const client: MailClient = {
    connect: async () => void calls.push('connect'),
    openInboxReadOnly: async () => (calls.push('examine'), { uidValidity }),
    listHeaders: async () => messages.map(({ raw: _r, ...h }) => h),
    fetchSource: async (uid) => {
      fetched.push(uid)
      const m = messages.find((x) => x.uid === uid)
      return m ? new TextEncoder().encode(m.raw) : null
    },
    close: async () => void calls.push('close'),
  }
  return { client, fetched, calls }
}

const msg = (uid: number, name: string, address: string, subject: string, body: string) => ({
  uid, from: { name, address }, subject, date: '2026-11-19T18:00:00.000Z', raw: eml(`${name} <${address}>`, subject, body, `m${uid}`),
})

describe('inbox check', () => {
  const inbox = [
    msg(10, 'Mom', 'mom@gmail.com', 'Dinner Sunday?', 'SECRET_FAMILY_BODY'),
    msg(11, 'Vectorline Recruiting', 'no-reply@ashbyhq.com', 'Next step: Vectorline assessment', 'Please complete the CodeSignal assessment.'),
    msg(12, 'Bank', 'alerts@bank.example', 'Your statement', 'SECRET_BANK_BODY'),
    msg(13, 'Hiring', 'no-reply@greenhouse-mail.io', 'Thanks for applying to Acme', 'SECRET_ACME_BODY'),
    msg(14, 'Kite Careers', 'careers@kitecareers.com', 'Kite weekly digest', 'Read our engineering blog.'),
  ]

  it('fetches only bodies whose headers match the board and sends only matched mail to the AI', async () => {
    const { deps, calls: aiCalls, vectorline } = await setup()
    const { client, fetched, calls } = fakeClient(inbox)
    const matchedRoles: string[] = []
    const res = await checkInbox(client, deps.roles.list(), { uidValidity: '', lastUid: 0, since: new Date('2026-11-01') }, async (email, role) => {
      matchedRoles.push(role.company)
      await ingestEmail(email, deps, { origin: 'inbox', roleId: role.id })
    })
    expect(fetched).toEqual([11, 14])
    expect(calls).toEqual(['connect', 'examine', 'close'])
    expect(res).toEqual({ uidValidity: '7', lastUid: 14, scanned: 5, candidates: 2, matched: 2 })
    expect(matchedRoles).toEqual(['Vectorline', 'Kite'])
    const sent = JSON.stringify(aiCalls)
    expect(sent).not.toMatch(/SECRET_|Dinner|statement|Acme/)
    expect(sent).toContain('CodeSignal')
    expect(deps.proposals.pending().map((p) => p.roleId)).toContain(vectorline.id)
  })

  it('skips messages already looked at, and starts over if the mailbox was rebuilt', async () => {
    const { deps } = await setup()
    const a = fakeClient(inbox)
    const res = await checkInbox(a.client, deps.roles.list(), { uidValidity: '7', lastUid: 11, since: new Date() }, async () => {})
    expect(a.fetched).toEqual([14])
    expect(res.scanned).toBe(3)
    const b = fakeClient(inbox, '8')
    await checkInbox(b.client, deps.roles.list(), { uidValidity: '7', lastUid: 99, since: new Date() }, async () => {})
    expect(b.fetched).toEqual([11, 14])
  })

  it('closes the connection even when a step fails', async () => {
    const { deps } = await setup()
    const { client, calls } = fakeClient(inbox)
    client.listHeaders = async () => {
      throw new Error('boom')
    }
    await expect(checkInbox(client, deps.roles.list(), { uidValidity: '', lastUid: 0, since: new Date() }, async () => {})).rejects.toThrow('boom')
    expect(calls.at(-1)).toBe('close')
  })
})
