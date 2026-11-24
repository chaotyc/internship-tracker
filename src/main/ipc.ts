import { BrowserWindow, ipcMain } from 'electron'
import type { Channel, EventName, IpcEvents, IpcResult, Req, Res } from '@shared/ipc'

/**
 * True for the app's own page: the bundled renderer (file://…/renderer/index.html) or,
 * in development, the electron-vite dev server. Other pages (such as autofill, which
 * loads third-party sites, or any other local file) never get to call handlers or
 * receive events. Packaged builds drop ELECTRON_RENDERER_URL at startup (index.ts).
 */
export function isAppUrl(url: string | undefined): boolean {
  if (!url) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) {
    try {
      if (u.origin === new URL(dev).origin) return true
    } catch {
      // A malformed dev URL counts for nothing.
    }
  }
  return u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html')
}

/** The calling frame is the app page itself, not a frame embedded in it. */
function fromAppFrame(frame: { url?: string; parent?: unknown } | null | undefined): boolean {
  if (!frame || frame.parent) return false
  return isAppUrl(frame.url)
}

/** Registers a typed handler. Thrown errors reach the renderer as their message. */
export function handle<C extends Channel>(channel: C, fn: (req: Req<C>) => Promise<Res<C>> | Res<C>): void {
  ipcMain.handle(channel, async (e, req: Req<C>): Promise<IpcResult<Res<C>>> => {
    if (!fromAppFrame(e.senderFrame)) return { ok: false, error: 'Not allowed' }
    try {
      return { ok: true, value: await fn(req) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] ${channel} failed:`, err)
      return { ok: false, error: message }
    }
  })
}

/** Pushes an event to every open app window. */
export function emit<E extends EventName>(event: E, payload: IpcEvents[E]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && isAppUrl(w.webContents.getURL())) w.webContents.send(event, payload)
  }
}
