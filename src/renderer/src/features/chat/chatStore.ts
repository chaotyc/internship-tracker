import { useSyncExternalStore } from 'react'
import { api } from '@renderer/lib/api'

/**
 * The assistant's in-flight request, live reply, draft and context role. Lives outside ChatPanel so
 * closing the sidebar mid-reply doesn't lose them: reopening shows the streaming reply, Stop and then the answer.
 */
export interface ChatRun {
  draft: string
  /** The role the next message is about (the Context picker); null for all roles. */
  contextId: string | null
  sending: boolean
  stream: string
  error: string | null
  /** Bumped when a send settles, so a mounted panel reloads the history. */
  settled: number
}

let state: ChatRun = { draft: '', contextId: null, sending: false, stream: '', error: null, settled: 0 }
const listeners = new Set<() => void>()

function update(patch: Partial<ChatRun>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

let listening = false
function listen() {
  if (listening) return
  listening = true
  api.on('chat:delta', ({ text }) => update({ stream: text }))
}

export function useChatRun(): ChatRun {
  listen()
  return useSyncExternalStore(subscribe, () => state)
}

export const chatRun = {
  setDraft: (draft: string) => update({ draft }),
  setContext: (contextId: string | null) => update({ contextId }),
  setError: (error: string | null) => update({ error }),
  /** Sends a message (or retries the last one) and keeps the reply here until it settles. */
  async send(text: string, roleId: string | null, retry: boolean) {
    listen()
    update({ error: null, sending: true, stream: '' })
    try {
      await api.invoke('chat:send', { text, roleId, retry })
    } catch (e) {
      update({ error: (e as Error).message })
    } finally {
      update({ sending: false, stream: '', settled: state.settled + 1 })
    }
  },
}
