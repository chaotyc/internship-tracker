/**
 * Headless mode (TRACKER_HEADLESS=1, implied by TRACKER_SNAPSHOT and TRACKER_SMOKE): windows render
 * off-screen, never show, and the app stays out of the Dock, so screenshot runs and
 * automated checks never take focus. Any feature that opens a BrowserWindow should
 * pass `headlessWindowOptions()` into its webPreferences and skip `show()` when headless.
 */
export function isHeadless(): boolean {
  return process.env['TRACKER_HEADLESS'] === '1' || !!process.env['TRACKER_SNAPSHOT'] || process.env['TRACKER_SMOKE'] === '1'
}

export function headlessWindowOptions(): { show?: boolean; webPreferences: { offscreen: boolean } } {
  return isHeadless() ? { show: false, webPreferences: { offscreen: true } } : { webPreferences: { offscreen: false } }
}
