import { BrowserWindow, ipcMain } from 'electron'
import type { Channel, EventName, IpcEvents, IpcResult, Req, Res } from '@shared/ipc'

/**
 * True for the app's own pages: the bundled renderer (file://) or, in development,
 * the electron-vite dev server. Other windows (such as autofill, which loads
 * third-party sites) never get to call handlers or receive events.
 */
export function isAppUrl(url: string | undefined): boolean {
  if (!url) return false
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev && url.startsWith(dev)) return true
  return url.startsWith('file://')
}

/** Registers a typed handler. Thrown errors reach the renderer as their message. */
export function handle<C extends Channel>(channel: C, fn: (req: Req<C>) => Promise<Res<C>> | Res<C>): void {
  ipcMain.handle(channel, async (e, req: Req<C>): Promise<IpcResult<Res<C>>> => {
    if (!isAppUrl(e.senderFrame?.url)) return { ok: false, error: 'Not allowed' }
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
