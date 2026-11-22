import { BrowserWindow, ipcMain } from 'electron'
import type { Channel, EventName, IpcEvents, IpcResult, Req, Res } from '@shared/ipc'

/** Registers a typed handler. Thrown errors reach the renderer as their message. */
export function handle<C extends Channel>(channel: C, fn: (req: Req<C>) => Promise<Res<C>> | Res<C>): void {
  ipcMain.handle(channel, async (_e, req: Req<C>): Promise<IpcResult<Res<C>>> => {
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
    if (!w.isDestroyed() && w.webContents.getURL().length) w.webContents.send(event, payload)
  }
}
