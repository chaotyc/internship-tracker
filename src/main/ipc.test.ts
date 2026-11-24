import { afterEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ handlers: new Map<string, (e: unknown, req: unknown) => Promise<unknown>>() }))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: (ch: string, fn: never) => m.handlers.set(ch, fn) },
}))

import { handle, isAppUrl } from './ipc'

afterEach(() => {
  delete process.env['ELECTRON_RENDERER_URL']
})

describe('isAppUrl', () => {
  it("accepts only the app's own page", () => {
    expect(isAppUrl('file:///Applications/Internship%20Tracker.app/Contents/Resources/app.asar/out/renderer/index.html#view=today')).toBe(true)
    expect(isAppUrl('file:///C:/Program%20Files/Internship%20Tracker/resources/app.asar/out/renderer/index.html')).toBe(true)
    expect(isAppUrl('file:///Users/someone/Downloads/page.html')).toBe(false)
    expect(isAppUrl('https://job-boards.greenhouse.io/acme/jobs/123')).toBe(false)
    expect(isAppUrl('http://localhost:5173/')).toBe(false)
    expect(isAppUrl('')).toBe(false)
    expect(isAppUrl(undefined)).toBe(false)
  })

  it('accepts the dev server by origin, not by prefix', () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    expect(isAppUrl('http://localhost:5173/#view=board')).toBe(true)
    expect(isAppUrl('http://localhost:51730/')).toBe(false)
    expect(isAppUrl('http://localhost:5173.evil.example/')).toBe(false)
  })
})

describe('handle', () => {
  it('refuses frames embedded in the app page', async () => {
    handle('roles:list' as never, () => [] as never)
    const fn = m.handlers.get('roles:list')!
    const url = 'file:///app/out/renderer/index.html'
    expect(await fn({ senderFrame: { url, parent: null } }, undefined)).toEqual({ ok: true, value: [] })
    expect(await fn({ senderFrame: { url, parent: {} } }, undefined)).toEqual({ ok: false, error: 'Not allowed' })
    expect(await fn({ senderFrame: null }, undefined)).toEqual({ ok: false, error: 'Not allowed' })
  })
})
