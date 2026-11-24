import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }))

import { EMPTY_PROFILE, type Profile } from '@shared/profile'
import { describeAction, visibleReply } from '@shared/chat'
import { openStore } from '../../db/store'
import { RolesService, rolesMigrations } from '../roles/service'
import { applyAction, parseReply, roleResolver, validateAction } from './actions'
import { ChatStore, chatMigrations } from './store'

const fence = (body: string) => '```action\n' + body + '\n```'

describe('parseReply', () => {
  it('pulls out valid action blocks and strips them from the text', () => {
    const text = [
      'That role is a **strong** fit.',
      '',
      fence('{"kind":"add_role","role":{"company":"Vectorline","title":"Inference Intern","fit":"strong","stage":"Saved"}}'),
      '',
      'Want me to draft answers too?',
    ].join('\n')
    const out = parseReply(text)
    expect(out.text).toBe('That role is a **strong** fit.\n\nWant me to draft answers too?')
    expect(out.actions).toEqual([
      { kind: 'add_role', role: { company: 'Vectorline', title: 'Inference Intern', stage: 'saved', fit: 'Strong', source: 'chat' } },
    ])
  })

  it('ignores invalid JSON, unknown kinds and missing fields, but still hides them', () => {
    const text = [
      'Hello',
      fence('{not json'),
      fence('{"kind":"delete_everything"}'),
      fence('{"kind":"add_role","role":{"company":"","title":"x"}}'),
      fence('{"kind":"save_answers","answers":[{"question":"Start date?","answer":""}]}'),
      fence('{"kind":"update_preferences","preferences":{"bogus":1}}'),
    ].join('\n')
    const out = parseReply(text)
    expect(out.actions).toEqual([])
    expect(out.text).toBe('Hello')
  })

  it('accepts arrays, trailing commas, a same-line fence and dedupes', () => {
    const pref = '{"kind":"update_preferences","preferences":{"remoteOk":"true","locations":"NYC, Boston",},}'
    const text = 'Ok\n```action ' + pref + '```\n' + fence(`[${pref.replace(/,}/g, '}').replace(/,\}/g, '}')}, {"kind":"save_answers","answers":[{"question":"Start date?","answer":"June 2027"}]}]`)
    const out = parseReply(text)
    expect(out.text).toBe('Ok')
    expect(out.actions).toEqual([
      { kind: 'update_preferences', preferences: { remoteOk: true, locations: ['NYC', 'Boston'] } },
      { kind: 'save_answers', answers: [{ question: 'Start date?', answer: 'June 2027' }] },
    ])
  })

  it('reads role types and degree level, ignoring unknown values', () => {
    const out = parseReply(fence('{"kind":"update_preferences","preferences":{"roleTypes":["internships","new grad","bogus"],"degreeLevel":"bachelors"}}'))
    expect(out.actions).toEqual([{ kind: 'update_preferences', preferences: { roleTypes: ['internship', 'newgrad'], degreeLevel: 'bachelors' } }])
    expect(parseReply(fence('{"kind":"update_preferences","preferences":{"roleTypes":["bogus"],"degreeLevel":"high school"}}')).actions).toEqual([])
    expect(describeAction({ kind: 'update_preferences', preferences: { roleTypes: ['internship', 'fulltime'], degreeLevel: '' } }).rows).toEqual([
      { label: 'Role types', value: 'Internships, Any full-time' },
      { label: 'Degree level', value: 'From your education' },
    ])
  })

  it('hides an unterminated block at the end', () => {
    expect(parseReply('Here you go.\n```action\n{"kind":"add_r').text).toBe('Here you go.')
  })

  it('resolves short role ids and drops moves to unknown roles or stages', () => {
    const resolve = roleResolver([{ id: 'abcdef12-0000-4000-8000-000000000001' }, { id: 'bbbbbbbb-0000-4000-8000-000000000002' }])
    expect(validateAction({ kind: 'move_role', roleId: 'abcdef12', stage: 'Interviewing' }, resolve)).toEqual({
      kind: 'move_role',
      roleId: 'abcdef12-0000-4000-8000-000000000001',
      stage: 'interviewing',
    })
    expect(validateAction({ kind: 'move_role', roleId: 'zzzzzzzz', stage: 'applied' }, resolve)).toBeNull()
    expect(validateAction({ kind: 'move_role', roleId: 'abcdef12', stage: 'hired' }, resolve)).toBeNull()
  })

  it('drops links that are not http(s) and malformed deadlines', () => {
    const a = validateAction({ kind: 'add_role', role: { company: 'A', title: 'B', link: 'javascript:alert(1)', deadline: 'soon' } })
    expect(a).toEqual({ kind: 'add_role', role: { company: 'A', title: 'B', stage: 'saved', source: 'chat' } })
  })
})

describe('visibleReply (streaming)', () => {
  it('cuts an action block that has started but not finished', () => {
    expect(visibleReply('Sure.\n\n```action\n{"kind":')).toBe('Sure.')
    expect(visibleReply('Sure.\n\n``')).toBe('Sure.')
    expect(visibleReply('Run `npm')).toBe('Run `npm')
    expect(visibleReply('A\n' + fence('{}') + '\nB')).toBe('A\n\nB')
  })
})

describe('describeAction', () => {
  it('summarises each kind', () => {
    expect(describeAction({ kind: 'save_answers', answers: [{ question: 'Q', answer: 'A' }] }).title).toBe('Save 1 answer to your profile')
    expect(describeAction({ kind: 'move_role', roleId: 'x', stage: 'applied' }, { roleName: () => 'Vectorline · Intern' })).toEqual({
      title: 'Move to Applied',
      rows: [{ label: 'Role', value: 'Vectorline · Intern' }],
    })
    expect(describeAction({ kind: 'update_preferences', preferences: { remoteOk: false, keywords: [] } }).rows).toEqual([
      { label: 'Open to remote', value: 'No' },
      { label: 'Keywords', value: '(none)' },
    ])
  })
})

describe('applyAction and the chat store', () => {
  async function setup() {
    const store = await openStore(null)
    store.migrate([...rolesMigrations, ...chatMigrations])
    const roles = new RolesService(store, () => {})
    let profile: Profile = structuredClone(EMPTY_PROFILE)
    const profileSvc = { get: () => profile, save: (p: Profile) => (profile = p) }
    return { store, roles, chat: new ChatStore(store), deps: { roles, profile: profileSvc }, getProfile: () => profile }
  }

  it('adds roles once, moves roles and merges preferences and answers', async () => {
    const { roles, deps, getProfile } = await setup()
    await applyAction({ kind: 'add_role', role: { company: 'Vectorline', title: 'Inference Intern' } }, deps)
    await expect(applyAction({ kind: 'add_role', role: { company: 'vectorline ', title: 'inference intern' } }, deps)).rejects.toThrow(/already on your board/)
    const role = roles.list()[0]!
    expect(role.source).toBe('chat')

    await applyAction({ kind: 'move_role', roleId: role.id, stage: 'applied' }, deps)
    expect(roles.get(role.id)!.stage).toBe('applied')
    await expect(applyAction({ kind: 'move_role', roleId: 'gone', stage: 'applied' }, deps)).rejects.toThrow(/no longer/)

    await applyAction({ kind: 'update_preferences', preferences: { term: 'Summer 2027', locations: ['Remote'] } }, deps)
    expect(getProfile().preferences).toMatchObject({ term: 'Summer 2027', locations: ['Remote'], remoteOk: true })

    await applyAction({ kind: 'save_answers', answers: [{ question: 'Start date?', answer: 'May' }] }, deps)
    await applyAction({ kind: 'save_answers', answers: [{ question: 'start date?', answer: 'June' }, { question: 'Hear about us?', answer: 'Friend' }] }, deps)
    expect(getProfile().answers.map((a) => a.answer)).toEqual(['June', 'Friend'])
    expect(getProfile().answers[0]!.id).toBeTruthy()
  })

  it('stores messages in order with action states, and clears', async () => {
    const { chat } = await setup()
    chat.add({ role: 'user', content: 'hi', roleId: null })
    const a = chat.add({ role: 'assistant', content: 'hello', roleId: null, actions: [{ kind: 'move_role', roleId: 'r', stage: 'offer' }] })
    expect(a.actions[0]!.state).toBe('proposed')
    expect(chat.setActionState(a.id, 0, 'dismissed').actions[0]!.state).toBe('dismissed')
    expect(chat.list().map((m) => m.content)).toEqual(['hi', 'hello'])
    expect(() => chat.setActionState(a.id, 3, 'applied')).toThrow()
    chat.clear()
    expect(chat.list()).toEqual([])
  })
})

describe('set_next_step', () => {
  const resolve = roleResolver([{ id: 'abcdef12-0000-4000-8000-000000000001' }])

  it('validates the role, text, date and time', () => {
    const block = fence('{"kind":"set_next_step","roleId":"abcdef12","text":"  Finish the   take-home ","due":"2026-12-02","time":"14:30"}')
    expect(parseReply(`Done.\n${block}`, resolve).actions).toEqual([
      { kind: 'set_next_step', roleId: 'abcdef12-0000-4000-8000-000000000001', text: 'Finish the take-home', due: '2026-12-02', time: '14:30' },
    ])
    // Bad date drops the date (and its time) but keeps the step; unknown role or empty text drops the action.
    expect(validateAction({ kind: 'set_next_step', roleId: 'abcdef12', text: 'Email Sam', due: 'next week', time: '10:00' }, resolve)).toMatchObject({ due: '', time: '' })
    expect(validateAction({ kind: 'set_next_step', roleId: 'abcdef12', nextStep: { text: 'Prep', due: '2026-02-30' } }, resolve)).toMatchObject({ text: 'Prep', due: '' })
    expect(validateAction({ kind: 'set_next_step', roleId: 'zzzzzzzz', text: 'x' }, resolve)).toBeNull()
    expect(validateAction({ kind: 'set_next_step', roleId: 'abcdef12', text: ' ' }, resolve)).toBeNull()
  })

  it('applies through the roles service and describes itself', async () => {
    const store = await openStore(null)
    store.migrate(rolesMigrations)
    const roles = new RolesService(store, () => {})
    const role = roles.create({ company: 'Vectorline', title: 'Inference Intern' })
    const deps = { roles, profile: { get: () => structuredClone(EMPTY_PROFILE), save: (p: Profile) => p } }
    await applyAction({ kind: 'set_next_step', roleId: role.id, text: 'Prep for the screen', due: '2026-12-01', time: '09:00' }, deps)
    expect(roles.get(role.id)!.nextStep).toEqual({ text: 'Prep for the screen', due: '2026-12-01', time: '09:00', done: false, source: 'chat' })
    await expect(applyAction({ kind: 'set_next_step', roleId: 'gone', text: 'x', due: '', time: '' }, deps)).rejects.toThrow(/no longer/)
    expect(describeAction({ kind: 'set_next_step', roleId: role.id, text: 'Prep', due: '2026-12-01', time: '' }, { roleName: () => 'Vectorline · Intern' })).toEqual({
      title: 'Set the next step',
      rows: [
        { label: 'Role', value: 'Vectorline · Intern' },
        { label: 'Next step', value: 'Prep' },
        { label: 'Due', value: '2026-12-01' },
      ],
    })
  })
})
