import { writeFileSync } from 'node:fs'
import { app, safeStorage, type BrowserWindow } from 'electron'
import { removeThrowawayDir } from './headless'
import { insecureLinuxBackend } from './secrets'
import { APP_VERSION } from './version'

/**
 * Smoke test for packaged builds (TRACKER_SMOKE=1, used by scripts/smoke.mjs in CI).
 * Only runs against the throwaway demo database (TRACKER_DEMO=1). It waits until the
 * requested view has rendered, prints one `SMOKE {json}` line, optionally saves a
 * screenshot to TRACKER_SMOKE_PNG, and exits 0 on success or 1 on failure.
 *
 * The demo keeps secrets in memory, so the keychain is only checked when
 * TRACKER_SMOKE_KEYCHAIN=1 (CI machines, where no keychain prompt can appear): it
 * round-trips a value through the OS keychain and reports whether that worked.
 */
export function isSmoke(): boolean {
  return process.env['TRACKER_SMOKE'] === '1' && process.env['TRACKER_DEMO'] === '1'
}

/** What has to be on screen before a view counts as rendered. */
const READY: Record<string, string> = {
  board: '[data-card]',
  today: '.td-row',
  suggestions: 'article.sugg',
  chat: '.chat-composer',
  add: '.dialog',
  role: '.dialog',
  skipped: '.skipped-row',
  onboarding: '.onb-step',
  // The AI step is ready once the CLI check has come back.
  'onboarding-ai': '.onb-cli',
}

function readySelector(view: string): string {
  if (view.startsWith('settings')) return '.settings'
  if (view.startsWith('onboarding') && !READY[view]) return '.onb-step'
  return READY[view] ?? '#root > *'
}

export interface SmokeResult {
  ok: boolean
  view: string
  platform: string
  arch: string
  version: string
  found: number
  /** Keychain round trip: true, false, or null when not checked. */
  keychain: boolean | null
  storageBackend: string | null
  errors: string[]
  /** Expected conditions worth reporting, such as no keyring on a Linux machine. */
  notes: string[]
  ms: number
}

/** Encrypts and decrypts a value with the OS keychain, giving up after 15 s. */
async function probeKeychain(): Promise<{ ok: boolean; error?: string }> {
  const attempt = (async () => {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return { ok: false, error: 'no keychain available' }
    if (insecureLinuxBackend()) return { ok: false, error: 'no keyring; Electron would fall back to basic_text' }
    const blob = await safeStorage.encryptStringAsync('smoke')
    const { result } = await safeStorage.decryptStringAsync(blob)
    return result === 'smoke' ? { ok: true } : { ok: false, error: 'round trip returned a different value' }
  })()
  const timeout = new Promise<{ ok: boolean; error: string }>((r) => setTimeout(() => r({ ok: false, error: 'keychain timed out' }), 15_000))
  try {
    return await Promise.race([attempt, timeout])
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export function runSmoke(win: BrowserWindow, opts: { view: string }): void {
  const started = Date.now()
  const errors: string[] = []
  const notes: string[] = []
  const view = opts.view || 'board'
  const selector = readySelector(view)

  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(e.message)
  })
  win.webContents.on('render-process-gone', (_e, details) => finish(false, 0, `renderer gone: ${details.reason}`))
  win.webContents.on('did-fail-load', (_e, code, desc) => finish(false, 0, `load failed: ${code} ${desc}`))

  let done = false
  async function finish(ok: boolean, found: number, error?: string): Promise<void> {
    if (done) return
    done = true
    if (error) errors.push(error)
    const png = process.env['TRACKER_SMOKE_PNG']
    if (png && !win.isDestroyed()) {
      try {
        writeFileSync(png, (await win.webContents.capturePage()).toPNG())
      } catch (err) {
        errors.push(`screenshot failed: ${String(err)}`)
      }
    }
    let storageBackend: string | null = null
    if (process.platform === 'linux') {
      try {
        storageBackend = safeStorage.getSelectedStorageBackend()
      } catch {
        storageBackend = null
      }
    }
    let keychain: boolean | null = null
    if (process.env['TRACKER_SMOKE_KEYCHAIN'] === '1') {
      const probe = await probeKeychain()
      keychain = probe.ok
      if (probe.error) notes.push(`keychain: ${probe.error}`)
    }
    const result: SmokeResult = {
      ok,
      view,
      platform: process.platform,
      arch: process.arch,
      version: APP_VERSION,
      found,
      keychain,
      storageBackend,
      errors,
      notes,
      ms: Date.now() - started,
    }
    process.stdout.write(`SMOKE ${JSON.stringify(result)}\n`)
    removeThrowawayDir()
    app.exit(ok ? 0 : 1)
  }

  const deadline = started + Number(process.env['TRACKER_SMOKE_TIMEOUT'] ?? 30_000)
  win.webContents.once('did-finish-load', () => {
    const poll = async (): Promise<void> => {
      if (done) return
      let found = 0
      try {
        found = (await win.webContents.executeJavaScript(`document.querySelectorAll(${JSON.stringify(selector)}).length`)) as number
      } catch (err) {
        errors.push(`probe failed: ${String(err)}`)
      }
      // Let layout settle a moment so the screenshot shows the finished view.
      if (found > 0) setTimeout(() => void finish(true, found), 800)
      else if (Date.now() > deadline) void finish(false, 0, `timed out waiting for ${selector}`)
      else setTimeout(() => void poll(), 250)
    }
    void poll()
  })
}
