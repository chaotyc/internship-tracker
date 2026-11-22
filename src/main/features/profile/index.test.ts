import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Every native piece is mocked: no dialog, window or Finder ever opens during tests.
const m = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, req: unknown) => Promise<{ ok: boolean; value?: unknown; error?: string }>>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showItemInFolder: vi.fn(),
  openPath: vi.fn(async () => ''),
  sent: [] as string[],
  downloads: '',
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: never) => m.handlers.set(ch, fn) },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { getURL: () => 'app://x', send: (ev: string) => m.sent.push(ev) } }] },
  dialog: { showOpenDialog: m.showOpenDialog, showSaveDialog: m.showSaveDialog },
  shell: { showItemInFolder: m.showItemInFolder, openPath: m.openPath },
  app: { getPath: () => m.downloads },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('E' + Buffer.from(s).toString('base64')),
    decryptString: (b: Buffer) => Buffer.from(b.toString().slice(1), 'base64').toString(),
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (s: string) => Buffer.from('E' + Buffer.from(s).toString('base64')),
    decryptStringAsync: async (b: Buffer) => ({ result: Buffer.from(b.toString().slice(1), 'base64').toString(), shouldReEncrypt: false }),
  },
}))

import { openStore } from '../../db/store'
import { Secrets, secretsMigration } from '../../secrets'
import { Settings, settingsMigration } from '../../settings'
import type { FeatureContext, Services } from '../../context'
import { profileFeature } from './index'

let dir: string

async function boot() {
  const store = await openStore(null)
  store.migrate([settingsMigration, secretsMigration, { id: 't-roles', sql: 'CREATE TABLE roles (id TEXT, company TEXT)' }])
  store.run("INSERT INTO roles VALUES ('r1', 'Acme')")
  const secrets = new Secrets(store)
  await secrets.load()
  const ctx: FeatureContext = {
    store,
    secrets,
    settings: new Settings(store),
    services: { roles: { list: () => store.all('SELECT * FROM roles') } } as unknown as Services,
    dataDir: join(dir, 'data'),
    mainWindow: () => null,
  }
  profileFeature.register(ctx)
  const call = async (ch: string, req?: unknown) => {
    const res = await m.handlers.get(ch)!({}, req)
    if (!res.ok) throw new Error(res.error)
    return res.value as never
  }
  return { ctx, call }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'profile-ipc-'))
  m.downloads = dir
  m.handlers.clear()
  m.sent.length = 0
  vi.clearAllMocks()
  delete process.env['TRACKER_DEMO']
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('profile IPC', () => {
  it('saves, emits profile:changed and reports status', async () => {
    const { call } = await boot()
    const saved = await call('profile:save', { legalFirstName: 'Jordan', email: 'jordan@example.com' })
    expect(saved).toMatchObject({ legalFirstName: 'Jordan', email: 'jordan@example.com' })
    expect(m.sent).toContain('profile:changed')
    expect(await call('profile:status')).toMatchObject({ encrypted: true, demo: false, resumesDir: join(dir, 'data', 'resumes') })
    await expect(call('profile:save', { email: 'nope' })).rejects.toThrow(/name@example.com/)
  })

  it('imports a resume chosen in the open dialog, and returns null when cancelled', async () => {
    const { call } = await boot()
    m.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await call('profile:importResume')).toBeNull()

    const src = join(dir, 'Jordan Resume.md')
    writeFileSync(src, '# Jordan\n\nKernels, compilers')
    m.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [src] })
    const res = (await call('profile:importResume')) as { profile: { resume: { storedPath: string; text: string } }; warning: null }
    expect(m.showOpenDialog.mock.calls[1]![0]).toMatchObject({ filters: [{ extensions: ['pdf', 'docx', 'txt', 'md'] }] })
    expect(res.warning).toBeNull()
    expect(res.profile.resume.storedPath).toBe(join(dir, 'data', 'resumes', 'Jordan Resume.md'))
    expect(res.profile.resume.text).toContain('Kernels, compilers')

    const removed = (await call('profile:removeResume')) as { resume: null }
    expect(removed.resume).toBeNull()
    expect(existsSync(join(dir, 'data', 'resumes'))).toBe(false)
  })

  it('imports dropped bytes', async () => {
    const { call } = await boot()
    const res = (await call('profile:importResumeData', { fileName: 'cv.txt', data: new Uint8Array(Buffer.from('hello there')) })) as {
      profile: { resume: { text: string } }
    }
    expect(res.profile.resume.text).toBe('hello there')
    await expect(call('profile:importResumeData', { fileName: 'cv.exe', data: new Uint8Array([1]) })).rejects.toThrow(/PDF, Word/)
  })

  it('exports to the path chosen in the save dialog, without secrets', async () => {
    const { ctx, call } = await boot()
    await call('profile:save', { email: 'jordan@example.com' })
    ctx.secrets.set('ai.key', 'sk-SECRET')
    ctx.settings.set('ai', { apiKey: 'sk-SECRET', provider: 'claude' })
    const out = join(dir, 'export.json')
    m.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: out })
    expect(await call('profile:exportAll')).toEqual({ path: out })
    const text = readFileSync(out, 'utf8')
    expect(text).not.toContain('SECRET')
    const json = JSON.parse(text)
    expect(json.profile.email).toBe('jordan@example.com')
    expect(json.roles).toEqual([{ id: 'r1', company: 'Acme' }])
    expect(json.settings).toEqual({ ai: { provider: 'claude' } })
    expect(m.showSaveDialog.mock.calls[0]![0].defaultPath).toMatch(/internship-tracker-export-\d{4}-\d{2}-\d{2}\.json$/)

    m.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    expect(await call('profile:exportAll')).toBeNull()
  })

  it('deletes everything: store, secrets and resume copies', async () => {
    const { ctx, call } = await boot()
    await call('profile:save', { email: 'jordan@example.com' })
    ctx.secrets.set('ai.key', 'sk-SECRET')
    await call('profile:importResumeData', { fileName: 'cv.txt', data: new Uint8Array(Buffer.from('hi')) })
    await call('profile:deleteAll')
    expect(ctx.store.all('SELECT * FROM roles')).toEqual([])
    expect(ctx.store.all('SELECT * FROM secrets')).toEqual([])
    expect(existsSync(join(dir, 'data', 'resumes'))).toBe(false)
    expect((await call('profile:get')) as { email: string }).toMatchObject({ email: '', resume: null })
    expect(m.sent).toContain('roles:changed')
  })

  it('reveals the database file, or opens the folder when there is none yet', async () => {
    const { call } = await boot()
    await call('profile:revealData')
    expect(m.openPath).toHaveBeenCalledWith(join(dir, 'data'))
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'data', 'tracker.sqlite'), '')
    await call('profile:revealData')
    expect(m.showItemInFolder).toHaveBeenCalledWith(join(dir, 'data', 'tracker.sqlite'))
  })

  it('seeds the fictional demo profile only in demo mode, outside the real data folder', async () => {
    process.env['TRACKER_DEMO'] = '1'
    const { call } = await boot()
    const p = (await call('profile:get')) as { email: string; resume: { storedPath: string } }
    expect(p.email).toBe('alex@example.com')
    expect(p.resume.storedPath.startsWith(join(dir, 'data'))).toBe(false)
    delete process.env['TRACKER_DEMO']
  })
})
