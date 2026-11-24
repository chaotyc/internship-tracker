import { contextBridge, ipcRenderer } from 'electron'
import type { Api, IpcResult } from '@shared/ipc'

const CHANNEL = /^(roles|profile|ai|search|chat|autofill|today|onboarding):[A-Za-z]+$/

const api: Api = {
  async invoke(channel: string, ...req: unknown[]) {
    if (!CHANNEL.test(channel)) throw new Error(`Unknown channel ${channel}`)
    const res = (await ipcRenderer.invoke(channel, req[0])) as IpcResult<unknown>
    if (!res.ok) throw new Error(res.error)
    return res.value
  },
  on(event: string, listener: (payload: never) => void) {
    if (!CHANNEL.test(event)) throw new Error(`Unknown event ${event}`)
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload as never)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
} as Api

contextBridge.exposeInMainWorld('api', api)
