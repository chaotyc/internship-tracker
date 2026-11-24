import { afterEach, describe, expect, it, vi } from 'vitest'

// Handlers are captured, never registered with a real ipcMain; no keychain is touched (secrets stay in memory).
const m = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, req: unknown) => Promise<{ ok: boolean; value?: unknown; error?: string }>>(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: never) => m.handlers.set(ch, fn) },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { getSelectedStorageBackend: () => 'gnome_libsecret' },
}))

import type { OnboardingStatus } from '@shared/onboarding'
import { openStore, type Store } from '../../db/store'
import { Secrets, secretsMigration } from '../../secrets'
import { Settings, settingsMigration } from '../../settings'
import type { FeatureContext, Services } from '../../context'
import { onboardingFeature } from './index'
import { ONBOARDING_KEY, readState, shouldShow, writeState } from './state'

async function boot(opts: { roles?: number; store?: Store; keychain?: boolean } = {}) {
  const store = opts.store ?? (await openStore(null))
  store.migrate([settingsMigration, secretsMigration])
  const secrets = new Secrets(store, { memory: true })
  await secrets.load()
  if (opts.keychain === false) Object.defineProperty(secrets, 'available', { get: () => false })
  const roles = Array.from({ length: opts.roles ?? 0 }, (_, i) => ({ id: `r${i}` }))
  const settings = new Settings(store)
  const ctx: FeatureContext = {
    store,
    secrets,
    settings,
    services: { roles: { list: () => roles } } as unknown as Services,
    dataDir: '/nowhere',
    mainWindow: () => null,
  }
  onboardingFeature.register(ctx)
  const appFrame = { senderFrame: { url: 'file:///app/renderer/index.html' } }
  const call = async (ch: string, req?: unknown) => {
    const res = await m.handlers.get(ch)!(appFrame, req)
    if (!res.ok) throw new Error(res.error)
    return res.value as OnboardingStatus
  }
  return { store, settings, roles, call }
}

afterEach(() => {
  delete process.env['TRACKER_DEMO']
  m.handlers.clear()
})

describe('shouldShow', () => {
  it('shows only on a first launch with an empty board outside demo mode', () => {
    const state = { outcome: 'skipped' as const, at: '', step: 'ai' as const }
    expect(shouldShow({ state: null, demo: false, roleCount: 0 })).toBe(true)
    expect(shouldShow({ state: null, demo: true, roleCount: 0 })).toBe(false)
    expect(shouldShow({ state: null, demo: false, roleCount: 3 })).toBe(false)
    expect(shouldShow({ state, demo: false, roleCount: 0 })).toBe(false)
  })
})

describe('readState', () => {
  it('ignores missing, malformed and unknown values', async () => {
    const { settings } = await boot()
    expect(readState(settings)).toBeNull()
    settings.set(ONBOARDING_KEY, 'yes')
    expect(readState(settings)).toBeNull()
    settings.set(ONBOARDING_KEY, { outcome: 'maybe' })
    expect(readState(settings)).toBeNull()
    settings.set(ONBOARDING_KEY, { outcome: 'completed', at: 5, step: 'nowhere' })
    expect(readState(settings)).toEqual({ outcome: 'completed', at: '', step: null })
    writeState(settings, { outcome: 'skipped', at: '2026-01-01T00:00:00.000Z', step: 'profile' })
    expect(readState(settings)).toEqual({ outcome: 'skipped', at: '2026-01-01T00:00:00.000Z', step: 'profile' })
  })
})

describe('onboarding IPC', () => {
  it('shows on first launch, then never again once finished', async () => {
    const { call } = await boot()
    const first = await call('onboarding:status')
    expect(first).toMatchObject({ show: true, state: null, canStoreKeys: true, demo: false })
    const done = await call('onboarding:finish', { outcome: 'completed', step: 'done' })
    expect(done.show).toBe(false)
    expect(done.state).toMatchObject({ outcome: 'completed', step: 'done' })
    expect(Date.parse(done.state!.at)).not.toBeNaN()
    expect((await call('onboarding:status')).show).toBe(false)
  })

  it('remembers a skip in the store, so a restart on the same database stays quiet', async () => {
    const a = await boot()
    await a.call('onboarding:finish', { outcome: 'skipped', step: 'ai' })
    m.handlers.clear()
    const b = await boot({ store: a.store })
    const st = await b.call('onboarding:status')
    expect(st.show).toBe(false)
    expect(st.state).toMatchObject({ outcome: 'skipped', step: 'ai' })
  })

  it('shows again after Delete everything empties the store', async () => {
    const { call, store } = await boot()
    await call('onboarding:finish', { outcome: 'completed', step: 'done' })
    store.run('DELETE FROM settings')
    expect((await call('onboarding:status')).show).toBe(true)
  })

  it('stays out of the way for a board that already has roles, and remembers that', async () => {
    const { call, roles } = await boot({ roles: 2 })
    const st = await call('onboarding:status')
    expect(st.show).toBe(false)
    expect(st.state?.outcome).toBe('existing')
    // Emptying the board later doesn't bring the tour back.
    roles.length = 0
    expect((await call('onboarding:status')).show).toBe(false)
  })

  it('never opens by itself in demo mode, and records nothing there', async () => {
    process.env['TRACKER_DEMO'] = '1'
    const { call, settings } = await boot({ roles: 5 })
    expect(await call('onboarding:status')).toMatchObject({ show: false, demo: true, state: null })
    expect(readState(settings)).toBeNull()
  })

  it('reports when API keys cannot be stored', async () => {
    const { call } = await boot({ keychain: false })
    expect((await call('onboarding:status')).canStoreKeys).toBe(false)
  })

  it('rejects unknown outcomes and drops unknown steps', async () => {
    const { call } = await boot()
    await expect(call('onboarding:finish', { outcome: 'existing', step: 'done' })).rejects.toThrow(/Unknown tour outcome/)
    const st = await call('onboarding:finish', { outcome: 'skipped', step: 'elsewhere' })
    expect(st.state).toMatchObject({ outcome: 'skipped', step: null })
  })
})
