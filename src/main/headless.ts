import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Headless mode (TRACKER_HEADLESS=1, implied by TRACKER_SNAPSHOT and TRACKER_SMOKE): windows render
 * off-screen, never show, and the app stays out of the Dock, so screenshot runs and
 * automated checks never take focus. Any feature that opens a BrowserWindow should
 * pass `headlessWindowOptions()` into its webPreferences and skip `show()` when headless.
 * Packaged builds ignore TRACKER_SNAPSHOT, and honor TRACKER_HEADLESS and TRACKER_SMOKE
 * only with the throwaway demo database (index.ts clears them otherwise), so an
 * installed copy can never run invisibly over the user's real data.
 */
export function isHeadless(): boolean {
  return process.env['TRACKER_HEADLESS'] === '1' || !!process.env['TRACKER_SNAPSHOT'] || process.env['TRACKER_SMOKE'] === '1'
}

export function headlessWindowOptions(): { show?: boolean; webPreferences: { offscreen: boolean } } {
  return isHeadless() ? { show: false, webPreferences: { offscreen: true } } : { webPreferences: { offscreen: false } }
}

let throwawayDir: string | null = null
const THROWAWAY_PREFIX = 'internship-tracker-demo-'

/**
 * Makes a fresh folder for a demo run's browser profile, so demo runs never touch the
 * real app folder or each other. Chromium writes a few files while exiting, so folders
 * left by earlier runs (older than an hour, so never one in use) are cleared here.
 */
export function makeThrowawayDir(): string {
  const now = Date.now()
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith(THROWAWAY_PREFIX)) continue
      const dir = join(tmpdir(), name)
      if (now - statSync(dir).mtimeMs > 3_600_000) rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    // Cleanup is best effort.
  }
  throwawayDir = mkdtempSync(join(tmpdir(), THROWAWAY_PREFIX))
  return throwawayDir
}

/**
 * Removes the demo run's throwaway folder. Called on a normal quit and right before
 * the screenshot and smoke runs exit (app.exit skips the quit events). Best effort:
 * the system clears its temp folder anyway.
 */
export function removeThrowawayDir(): void {
  if (!throwawayDir) return
  try {
    rmSync(throwawayDir, { recursive: true, force: true })
  } catch {
    // A file still held open (Windows); the temp folder is cleared eventually.
  }
  throwawayDir = null
}
