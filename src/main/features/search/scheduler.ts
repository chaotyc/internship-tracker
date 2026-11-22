/**
 * The opt-in daily scan: while the app runs, at most once a day, plus a catch-up shortly after launch
 * when the last scan is over a day old. Nothing runs unless the user turned it on.
 */

export const DAY_MS = 86_400_000
/** How often the app checks whether a scan is due. */
export const TICK_MS = 60 * 60_000
/** Wait after launch before a catch-up scan, so startup stays quick. */
export const LAUNCH_DELAY_MS = 90_000

export interface ScanGate {
  enabled: boolean
  /** ISO time of the last scan attempt (manual or scheduled), or null. */
  lastScanAt: string | null
  running: boolean
  now: number
}

/** True when a scheduled scan should start now. */
export function scanDue(g: ScanGate): boolean {
  if (!g.enabled || g.running) return false
  if (!g.lastScanAt) return true
  const last = Date.parse(g.lastScanAt)
  if (!Number.isFinite(last)) return true
  return g.now - last >= DAY_MS
}

export interface SchedulerDeps {
  gate: () => Omit<ScanGate, 'now'>
  scan: () => Promise<unknown>
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => unknown
  setInterval?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (h: unknown) => void
  clearInterval?: (h: unknown) => void
}

/** Starts the checks. Returns a stop function. */
export function startScheduler(deps: SchedulerDeps): () => void {
  const now = deps.now ?? Date.now
  const st = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const si = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms))
  const ct = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const ci = deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>))
  let busy = false
  const tick = () => {
    if (busy || !scanDue({ ...deps.gate(), now: now() })) return
    busy = true
    void deps
      .scan()
      .catch(() => {})
      .finally(() => {
        busy = false
      })
  }
  const launch = st(tick, LAUNCH_DELAY_MS)
  const every = si(tick, TICK_MS)
  // Timers shouldn't keep the process alive on quit.
  for (const h of [launch, every]) (h as { unref?: () => void } | null)?.unref?.()
  return () => {
    ct(launch)
    ci(every)
  }
}
