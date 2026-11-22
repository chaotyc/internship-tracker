import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A fake keychain: reversible, but the plaintext never appears in the stored bytes.
const keychain = vi.hoisted(() => ({ available: true }))
vi.mock('electron', () => {
  const flip = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a))
  return {
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: vi.fn() },
    safeStorage: {
      isEncryptionAvailable: () => keychain.available,
      encryptString: (s: string) => Buffer.concat([Buffer.from('ENC1'), flip(Buffer.from(s, 'utf8'))]),
      decryptString: (b: Buffer) => {
        if (b.subarray(0, 4).toString() !== 'ENC1') throw new Error('bad blob')
        return flip(b.subarray(4)).toString('utf8')
      },
      isAsyncEncryptionAvailable: async () => keychain.available,
      encryptStringAsync: async (s: string) => Buffer.concat([Buffer.from('ENC1'), flip(Buffer.from(s, 'utf8'))]),
      decryptStringAsync: async (b: Buffer) => {
        if (b.subarray(0, 4).toString() !== 'ENC1') throw new Error('bad blob')
        return { result: flip(b.subarray(4)).toString('utf8'), shouldReEncrypt: false }
      },
    },
  }
})

import { answersForTrack, EMPTY_PROFILE, mergeWithDefaults, normalizeProfile, validateProfile, type Profile } from '@shared/profile'
import { openStore } from '../../db/store'
import { Secrets, secretsMigration } from '../../secrets'
import { Settings, settingsMigration } from '../../settings'
import { buildExport } from './export'
import { extractResumeText, importResume, NO_TEXT_WARNING, ResumeError, safeFileName } from './resume'
import { EncryptedProfileService, ProfileValidationError } from './service'
import { TrackError, TrackManager } from './tracks'

async function setup() {
  const store = await openStore(null)
  store.migrate([settingsMigration, secretsMigration])
  const secrets = new Secrets(store)
  await secrets.load()
  const settings = new Settings(store)
  const onChange = vi.fn()
  const svc = new EncryptedProfileService({ store, secrets, settings, onChange })
  return { store, secrets, settings, svc, onChange }
}

const filled = (over: Partial<Profile> = {}): Profile => ({
  ...EMPTY_PROFILE,
  legalFirstName: 'Jordan',
  legalLastName: 'Example',
  email: 'jordan@example.com',
  github: 'github.com/jordan-example',
  demographics: { ...EMPTY_PROFILE.demographics, veteran: 'decline', pronouns: 'she/her' },
  answers: [{ id: 'q1', question: 'Earliest start date?', answer: 'June 2027' }],
  ...over,
})

beforeEach(() => {
  keychain.available = true
})

describe('EncryptedProfileService', () => {
  it('round-trips through the keychain and leaves no plaintext on disk', async () => {
    const { store, secrets, svc, onChange } = await setup()
    const saved = svc.save(filled())
    expect(saved.github).toBe('https://github.com/jordan-example')
    expect(svc.get()).toEqual(saved)
    expect(onChange).toHaveBeenCalledTimes(1)

    await secrets.flush()
    const row = store.get<{ value: Uint8Array }>("SELECT value FROM secrets WHERE key = 'profile'")
    expect(row).toBeDefined()
    const raw = Buffer.from(row!.value).toString('latin1')
    expect(raw).not.toContain('jordan@example.com')
    expect(raw).not.toContain('Earliest start')
    expect(store.get("SELECT 1 FROM settings WHERE key = 'profile'")).toBeUndefined()
  })

  it('reads an older plain copy and moves it into the keychain on the next save', async () => {
    const { store, settings, svc } = await setup()
    settings.set('profile', { legalFirstName: 'Old', email: 'old@example.com' })
    expect(svc.get().legalFirstName).toBe('Old')
    svc.save({ ...svc.get(), city: 'Oakland' })
    expect(store.get("SELECT 1 FROM settings WHERE key = 'profile'")).toBeUndefined()
    expect(svc.get()).toMatchObject({ legalFirstName: 'Old', city: 'Oakland' })
  })

  it('without a keychain, stores the rest in plain settings but never demographics or saved answers', async () => {
    keychain.available = false
    const { store, settings, svc } = await setup()
    expect(svc.encrypted).toBe(false)
    const saved = svc.save(filled())
    expect(saved.email).toBe('jordan@example.com')
    expect(saved.demographics).toEqual(EMPTY_PROFILE.demographics)
    expect(saved.answers).toEqual([])
    expect(store.get('SELECT 1 FROM secrets')).toBeUndefined()
    const plain = JSON.stringify(settings.get('profile', {}))
    expect(plain).toContain('jordan@example.com')
    expect(plain).not.toContain('she/her')
    expect(plain).not.toContain('Earliest start')
  })

  it('keeps the stored resume whatever save() is given', async () => {
    const { svc } = await setup()
    svc.setResume({ fileName: 'r.txt', storedPath: '/x/r.txt', text: 'hello', updatedAt: '2026-01-01T00:00:00Z' })
    const saved = svc.save({ ...filled(), resume: null })
    expect(saved.resume?.fileName).toBe('r.txt')
  })

  it('refuses obviously wrong fields with readable messages', async () => {
    const { svc, onChange } = await setup()
    let err: unknown
    try {
      svc.save(filled({ email: 'jordan@', linkedin: 'github.com/me' }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ProfileValidationError)
    const e = err as ProfileValidationError
    expect(Object.keys(e.errors).sort()).toEqual(['email', 'linkedin'])
    expect(e.message).toMatch(/2 fields need attention/)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('validateProfile', () => {
  const v = (over: Partial<Profile>) => validateProfile({ ...EMPTY_PROFILE, ...over })
  it('accepts an empty profile', () => expect(v({})).toEqual({}))
  it('checks email, phone and links', () => {
    expect(v({ email: 'a@b.co' })).toEqual({})
    expect(v({ email: 'not an email' }).email).toMatch(/name@example.com/)
    expect(v({ phone: '+1 (555) 010-0199' })).toEqual({})
    expect(v({ phone: '12' }).phone).toMatch(/7 to 15 digits/)
    expect(v({ linkedin: 'linkedin.com/in/x', github: 'https://github.com/x', scholar: 'scholar.google.com/citations?user=1' })).toEqual({})
    expect(v({ github: 'gitlab.com/x' }).github).toMatch(/GitHub link/)
    expect(v({ website: 'not a site' }).website).toMatch(/doesn't look like a link/)
    expect(v({ website: 'ftp://x.com' }).website).toMatch(/https/)
  })
  it('checks education rows and saved answers', () => {
    const edu = { school: '', degree: 'BS', field: '', startDate: '2025-09', endDate: '2024-05', gpa: '4.3/4.0' }
    const errs = v({ education: [edu], answers: [{ id: 'a', question: '', answer: 'Yes' }] })
    expect(errs['education.0.school']).toMatch(/school name/)
    expect(errs['education.0.endDate']).toMatch(/before the start/)
    expect(errs['education.0.gpa']).toMatch(/higher than the scale/)
    expect(errs['answers.0.question']).toBeTruthy()
    expect(v({ education: [{ ...edu, school: 'X', endDate: '2029-05', gpa: '3.9' }] })).toEqual({})
  })
})

describe('mergeWithDefaults / normalizeProfile', () => {
  it('fills fields added later and drops wrong types', () => {
    const p = mergeWithDefaults({
      email: 'x@example.com',
      authorizedToWorkUS: 'yes',
      preferences: { targetRoles: ['Kernels intern', 3], remoteOk: false },
      demographics: { gender: 'decline' },
      education: [{ school: 'U' }, 'junk'],
      somethingRemoved: true,
    })
    expect(p.email).toBe('x@example.com')
    expect(p.authorizedToWorkUS).toBeNull()
    expect(p.preferences).toEqual({ ...EMPTY_PROFILE.preferences, targetRoles: ['Kernels intern'], remoteOk: false })
    expect(p.demographics).toEqual({ ...EMPTY_PROFILE.demographics, gender: 'decline' })
    expect(p.education).toEqual([{ school: 'U', degree: '', field: '', startDate: '', endDate: '', gpa: '' }])
    expect(p.resume).toBeNull()
    expect('somethingRemoved' in p).toBe(false)
    expect(mergeWithDefaults(null)).toEqual(EMPTY_PROFILE)
  })

  it('trims, completes links, dedupes chips and drops empty rows', () => {
    const p = normalizeProfile({
      ...EMPTY_PROFILE,
      email: '  a@b.co ',
      website: 'example.com/me',
      education: [{ school: ' ', degree: '', field: '', startDate: '', endDate: '', gpa: '' }],
      preferences: { ...EMPTY_PROFILE.preferences, keywords: ['CUDA', 'cuda ', ' ', 'Triton'] },
      answers: [{ id: '', question: 'Q', answer: ' A ' }, { id: 'x', question: '', answer: '' }],
    })
    expect(p.email).toBe('a@b.co')
    expect(p.website).toBe('https://example.com/me')
    expect(p.education).toEqual([])
    expect(p.preferences.keywords).toEqual(['CUDA', 'Triton'])
    expect(p.answers).toHaveLength(1)
    expect(p.answers[0]!.id).not.toBe('')
    expect(p.answers[0]!.answer).toBe('A')
  })
})

// --- Resume fixtures, generated here so the repo holds no documents. -----------------------

function makePdf(content: string): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, 'latin1'))
}

async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}

describe('resume text extraction', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'profile-test-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads text from a PDF', async () => {
    const pdf = makePdf('BT /F1 12 Tf 72 720 Td (Jordan Example) Tj 0 -16 Td (CUDA and PyTorch) Tj ET')
    const { text, warning } = await extractResumeText(pdf, 'resume.pdf')
    expect(warning).toBeNull()
    expect(text).toContain('Jordan Example')
    expect(text).toContain('CUDA and PyTorch')
  })

  it('explains a PDF with no text layer', async () => {
    const { text, warning } = await extractResumeText(makePdf('0 0 1 rg 72 72 200 200 re f'), 'scan.pdf')
    expect(text).toBe('')
    expect(warning).toBe(NO_TEXT_WARNING)
    expect(warning).toMatch(/No text found; it may be a scanned image/)
  })

  it('refuses a broken PDF clearly', async () => {
    await expect(extractResumeText(new Uint8Array(Buffer.from('not a pdf at all')), 'x.pdf')).rejects.toThrow(/couldn.t be opened/)
  })

  it('reads text from a DOCX', async () => {
    const { text } = await extractResumeText(await makeDocx(['Jordan Example', 'Research Assistant']), 'resume.docx')
    expect(text).toBe('Jordan Example\n\nResearch Assistant')
  })

  it('reads text and markdown, tidying whitespace', async () => {
    const { text } = await extractResumeText(new Uint8Array(Buffer.from('\uFEFF# Jordan  \r\n\r\n\r\n\r\nSkills\t\n')), 'r.md')
    expect(text).toBe('# Jordan\n\nSkills')
  })

  it('rejects other file types', async () => {
    await expect(extractResumeText(new Uint8Array([1]), 'r.doc')).rejects.toThrow(/\.docx or PDF/)
    await expect(extractResumeText(new Uint8Array([1]), 'r.png')).rejects.toBeInstanceOf(ResumeError)
  })

  it('stores one copy, replacing the previous file, and records it', async () => {
    const { svc } = await setup()
    const target = new TrackManager(svc, dir).target(null)
    await importResume(target, dir, 'old.txt', new Uint8Array(Buffer.from('old resume')))
    const { profile, warning } = await importResume(target, dir, '/Users/someone/My Resume.txt', new Uint8Array(Buffer.from('new resume')))
    expect(warning).toBeNull()
    expect(readdirSync(dir)).toEqual(['My Resume.txt'])
    expect(profile.resume).toMatchObject({ fileName: 'My Resume.txt', text: 'new resume', storedPath: join(dir, 'My Resume.txt') })
    expect(readFileSync(profile.resume!.storedPath, 'utf8')).toBe('new resume')
    expect(svc.get().resume?.text).toBe('new resume')
  })

  it('changes nothing when extraction fails', async () => {
    const { svc } = await setup()
    await expect(importResume(new TrackManager(svc, dir).target(null), dir, 'bad.pdf', new Uint8Array(Buffer.from('nope')))).rejects.toThrow()
    expect(existsSync(join(dir, 'bad.pdf'))).toBe(false)
    expect(svc.get().resume).toBeNull()
  })

  it('makes stored file names safe', () => {
    expect(safeFileName('../../etc/passwd.txt')).toBe('passwd.txt')
    expect(safeFileName('C:\\Users\\me\\cv:1.pdf')).toBe('cv_1.pdf')
  })
})

describe('buildExport', () => {
  it('includes roles, the decrypted profile, settings and feature tables, but no secrets', async () => {
    const { store, secrets, settings, svc } = await setup()
    svc.save(filled())
    secrets.set('ai.anthropic', 'sk-ant-SECRET-123')
    settings.set('ai', { provider: 'claude', apiKey: 'sk-ant-SECRET-123', model: 'x' })
    settings.set('openaiToken', 'tok-SECRET-456')
    settings.set('watchlist', ['etched', 'matx'])
    store.migrate([
      { id: 't-chats', sql: 'CREATE TABLE chats (id TEXT, body TEXT, meta TEXT, blob BLOB)' },
      { id: 't-sugg', sql: 'CREATE TABLE suggestions (id TEXT, title TEXT)' },
    ])
    store.run('INSERT INTO chats VALUES (?, ?, ?, ?)', ['c1', 'hello', '{"token":"tok-SECRET-789","n":1}', new Uint8Array([1, 2])])
    store.run('INSERT INTO suggestions VALUES (?, ?)', ['s1', 'Kernels intern'])

    const out = buildExport({ store, profile: svc, roles: { list: () => [{ id: 'r1', company: 'Acme' }] } })
    const json = JSON.stringify(out)
    expect(json).not.toContain('SECRET')
    expect(out['roles']).toEqual([{ id: 'r1', company: 'Acme' }])
    expect((out['profile'] as Profile).email).toBe('jordan@example.com')
    expect((out['profile'] as Profile).answers).toHaveLength(1)
    expect(out['settings']).toEqual({ ai: { provider: 'claude', model: 'x' }, watchlist: ['etched', 'matx'] })
    const tables = out['tables'] as Record<string, unknown[]>
    expect(Object.keys(tables).sort()).toEqual(['chats', 'suggestions'])
    expect(tables['chats']).toEqual([{ id: 'c1', body: 'hello', meta: { n: 1 } }])
    expect(tables['suggestions']).toEqual([{ id: 's1', title: 'Kernels intern' }])
  })

  it('skips tables that do not exist', async () => {
    const { store, svc } = await setup()
    const out = buildExport({ store, profile: svc })
    expect(out['roles']).toEqual([])
    expect(out['tables']).toEqual({})
  })
})

describe('application tracks', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracks-test-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const bytes = (s: string) => new Uint8Array(Buffer.from(s))

  it('normalizes stored tracks: bad and repeated ids dropped, missing fields filled, wrong types removed', () => {
    const p = mergeWithDefaults({
      tracks: [
        { id: 'ml', name: '  ML inference ', targetRoles: ['Kernels', 4], resume: { fileName: 'a.pdf', text: 'hi' }, answers: [{ question: 'Q' }, 'x'] },
        { id: 'ml', name: 'Duplicate' },
        { id: '../evil', name: 'Path trick' },
        { name: 'No id' },
        { id: 'hw', name: '', keywords: 'optics', resume: 'nope' },
        'junk',
      ],
    })
    expect(p.tracks).toEqual([
      {
        id: 'ml',
        name: 'ML inference',
        description: '',
        resume: { fileName: 'a.pdf', storedPath: '', text: 'hi', updatedAt: '' },
        targetRoles: ['Kernels'],
        keywords: [],
        answers: [{ id: '', question: 'Q', answer: '' }],
      },
      { id: 'hw', name: 'Untitled track', description: '', resume: null, targetRoles: [], keywords: [], answers: [] },
    ])
    expect(mergeWithDefaults({ tracks: 'nope' }).tracks).toEqual([])

    const n = normalizeProfile({
      ...EMPTY_PROFILE,
      tracks: [{ ...p.tracks[0]!, name: '  Photonics   hardware ', keywords: ['optics', 'Optics ', ' '], answers: [{ id: '', question: ' Why? ', answer: ' Because ' }, { id: 'e', question: '', answer: '' }] }],
    })
    expect(n.tracks[0]).toMatchObject({ name: 'Photonics hardware', keywords: ['optics'], answers: [{ question: 'Why?', answer: 'Because' }] })
    expect(n.tracks[0]!.answers[0]!.id).not.toBe('')
    expect(validateProfile({ ...EMPTY_PROFILE, tracks: [{ ...n.tracks[0]!, answers: [{ id: 'a', question: '', answer: 'x' }] }] })).toEqual({
      'tracks.0.answers.0.question': 'Add the question this answers.',
    })
  })

  it('first track takes over the profile resume and preferences; later tracks start empty', async () => {
    const { svc } = await setup()
    svc.save(filled({ preferences: { ...EMPTY_PROFILE.preferences, targetRoles: ['ML intern'], keywords: ['CUDA'] } }))
    const tm = new TrackManager(svc, dir)
    await tm.importResume(null, 'cv.txt', bytes('general resume'))
    expect(readdirSync(dir)).toEqual(['cv.txt'])

    const { profile, trackId } = tm.create()
    expect(profile.tracks).toHaveLength(1)
    expect(profile.tracks[0]).toMatchObject({ id: trackId, name: 'General', targetRoles: ['ML intern'], keywords: ['CUDA'] })
    expect(profile.tracks[0]!.resume).toMatchObject({ fileName: 'cv.txt', text: 'general resume', storedPath: join(dir, `${trackId}-cv.txt`) })
    expect(readdirSync(dir)).toEqual([`${trackId}-cv.txt`])
    expect(profile.resume?.storedPath).toBe(join(dir, `${trackId}-cv.txt`))

    const second = tm.create('Photonics')
    expect(second.profile.tracks[1]).toMatchObject({ name: 'Photonics', resume: null, targetRoles: [], keywords: [], answers: [] })
  })

  it("keeps each track's resume in its own file; importing for one never deletes another's", async () => {
    const { svc } = await setup()
    const tm = new TrackManager(svc, dir)
    const a = tm.create('ML').trackId
    const b = tm.create('Photonics').trackId
    await tm.importResume(a, 'resume.txt', bytes('ml resume'))
    await tm.importResume(b, 'resume.txt', bytes('photonics resume'))
    expect(readdirSync(dir).sort()).toEqual([`${a}-resume.txt`, `${b}-resume.txt`].sort())

    // Replacing A's resume removes only A's old file.
    await tm.importResume(a, 'ml-v2.txt', bytes('ml resume v2'))
    expect(readdirSync(dir).sort()).toEqual([`${a}-ml-v2.txt`, `${b}-resume.txt`].sort())
    expect(readFileSync(join(dir, `${b}-resume.txt`), 'utf8')).toBe('photonics resume')
    expect(svc.resumeFor(a)?.text).toBe('ml resume v2')
    expect(svc.resumeFor(b)?.text).toBe('photonics resume')

    // The legacy channel targets the default (first) track.
    await tm.importResume(null, 'default.txt', bytes('default v3'))
    expect(svc.get().tracks[0]!.resume?.text).toBe('default v3')
    expect(svc.get().resume?.text).toBe('default v3')
    expect(existsSync(join(dir, `${b}-resume.txt`))).toBe(true)

    tm.removeResume(b)
    expect(readdirSync(dir)).toEqual([`${a}-default.txt`])
    expect(svc.get().tracks[1]!.resume).toBeNull()
    await expect(tm.importResume('missing', 'x.txt', bytes('x'))).rejects.toBeInstanceOf(TrackError)
  })

  it('deleting a track deletes its file; deleting the only track keeps its resume as the profile resume', async () => {
    const { svc } = await setup()
    const tm = new TrackManager(svc, dir)
    const a = tm.create('ML').trackId
    const b = tm.create('Photonics').trackId
    await tm.importResume(a, 'a.txt', bytes('a'))
    await tm.importResume(b, 'b.txt', bytes('b'))

    const afterB = tm.delete(b)
    expect(afterB.tracks.map((t) => t.id)).toEqual([a])
    expect(readdirSync(dir)).toEqual([`${a}-a.txt`])

    const afterA = tm.delete(a)
    expect(afterA.tracks).toEqual([])
    expect(afterA.resume).toMatchObject({ text: 'a', storedPath: join(dir, `${a}-a.txt`) })
    expect(existsSync(join(dir, `${a}-a.txt`))).toBe(true)
    expect(() => tm.delete(a)).toThrow(TrackError)
  })

  it('deleting the default track makes the next one the default, removes the file, and resumes mirror it', async () => {
    const { svc } = await setup()
    const tm = new TrackManager(svc, dir)
    const a = tm.create('ML').trackId
    const b = tm.create('Photonics').trackId
    await tm.importResume(a, 'a.txt', bytes('a'))
    await tm.importResume(b, 'b.txt', bytes('b'))
    const p = tm.delete(a)
    expect(p.tracks[0]!.id).toBe(b)
    expect(p.resume?.text).toBe('b')
    expect(readdirSync(dir)).toEqual([`${b}-b.txt`])
  })

  it('reorders, sets the default, and edits a track', async () => {
    const { svc } = await setup()
    const tm = new TrackManager(svc, dir)
    const a = tm.create('A').trackId
    const b = tm.create('B').trackId
    const c = tm.create('C').trackId
    expect(tm.reorder([c, a]).tracks.map((t) => t.id)).toEqual([c, a, b])
    expect(tm.setDefault(b).tracks.map((t) => t.id)).toEqual([b, c, a])
    const p = tm.update(a, { name: '  Hardware ', keywords: ['optics', 'Optics'], answers: [{ id: '', question: 'Why us?', answer: 'Lasers' }] })
    expect(p.tracks.find((t) => t.id === a)).toMatchObject({ name: 'Hardware', keywords: ['optics'], answers: [{ question: 'Why us?', answer: 'Lasers' }] })
    expect(() => tm.update(a, { answers: [{ id: 'x', question: '', answer: 'orphan' }] })).toThrow(ProfileValidationError)
  })

  it('trackFor and resumeFor fall back to the default track, then the profile resume', async () => {
    const { svc } = await setup()
    const tm = new TrackManager(svc, dir)
    // No tracks: one implicit default made from the profile.
    await tm.importResume(null, 'cv.txt', bytes('profile resume'))
    expect(svc.tracks()).toHaveLength(1)
    expect(svc.tracks()[0]).toMatchObject({ id: 'default', name: 'General' })
    expect(svc.trackFor('anything').id).toBe('default')
    expect(svc.resumeFor('')?.text).toBe('profile resume')

    const a = tm.create('ML').trackId
    const b = tm.create('Photonics').trackId
    expect(svc.trackFor('').id).toBe(a)
    expect(svc.trackFor('gone').id).toBe(a)
    expect(svc.trackFor(b).id).toBe(b)
    // B has no resume yet: falls back to the default track's (the profile's).
    expect(svc.resumeFor(b)?.text).toBe('profile resume')
    await tm.importResume(b, 'p.txt', bytes('photonics'))
    expect(svc.resumeFor(b)?.text).toBe('photonics')
    expect(svc.tracks().map((t) => t.resume?.text)).toEqual(['profile resume', 'photonics'])
  })

  it('save() keeps tracks whatever it is given; without a keychain, track answers are never stored', async () => {
    const { svc } = await setup()
    const tm = new TrackManager(svc, dir)
    tm.create('ML')
    expect(svc.save({ ...filled(), tracks: [] }).tracks).toHaveLength(1)

    keychain.available = false
    const plain = await setup()
    const tm2 = new TrackManager(plain.svc, dir)
    const id = tm2.create('ML').trackId
    tm2.update(id, { answers: [{ id: 'a', question: 'Salary history?', answer: 'PRIVATE-ANSWER' }] })
    expect(JSON.stringify(plain.settings.get('profile', {}))).not.toContain('PRIVATE-ANSWER')
    expect(plain.svc.get().tracks[0]!.answers).toEqual([])
  })

  it("answer overrides take precedence over the profile's saved answers", () => {
    const p: Profile = {
      ...EMPTY_PROFILE,
      answers: [
        { id: '1', question: 'Why are you interested?', answer: 'General answer' },
        { id: '2', question: 'Earliest start date', answer: 'May 2027' },
      ],
    }
    const track = { id: 't', name: 'HW', description: '', resume: null, targetRoles: [], keywords: [], answers: [{ id: 'o', question: 'why are you interested', answer: 'Photonics answer' }] }
    expect(answersForTrack(p, track).map((a) => a.answer)).toEqual(['Photonics answer', 'May 2027'])
  })

  it('exports every track with its resume text, and no secrets', async () => {
    const { store, secrets, svc } = await setup()
    const tm = new TrackManager(svc, dir)
    const a = tm.create('ML').trackId
    tm.create('Photonics')
    await tm.importResume(a, 'a.txt', bytes('kernel work'))
    secrets.set('ai.anthropic', 'sk-ant-SECRET-123')
    const out = buildExport({ store, profile: svc })
    expect(JSON.stringify(out)).not.toContain('SECRET')
    const tracks = (out['profile'] as Profile).tracks
    expect(tracks.map((t) => t.name)).toEqual(['ML', 'Photonics'])
    expect(tracks[0]!.resume?.text).toBe('kernel work')
  })
})
