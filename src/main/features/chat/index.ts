import { randomUUID } from 'node:crypto'
import type { Feature, FeatureContext } from '../../context'
import { emit, handle } from '../../ipc'
import type { ChatMessage } from '@shared/chat'
import { applyAction, parseReply, roleResolver } from './actions'
import { buildSystemPrompt, historyForModel } from './prompt'
import { ChatStore, chatMigrations } from './store'
import { seedDemoChat } from './demo'

const DELTA_INTERVAL_MS = 33

function register(ctx: FeatureContext): void {
  const chat = new ChatStore(ctx.store)
  if (process.env['TRACKER_DEMO'] === '1' && process.env['TRACKER_DEMO_CHAT'] !== '0') seedDemoChat(chat)

  let current: AbortController | null = null

  handle('chat:history', () => chat.list())

  handle('chat:send', async ({ text, roleId, retry }) => {
    const { roles: rolesSvc, profile: profileSvc, ai } = ctx.services
    // One reply at a time: a new message replaces a reply still streaming.
    current?.abort()
    const controller = new AbortController()
    current = controller

    const last = chat.last()
    const retrying = retry && last?.role === 'user'
    // A retry answers the stored message about the role it was sent with, not the current picker.
    const aboutId = retrying ? last.roleId : roleId
    const openRole = aboutId ? rolesSvc.get(aboutId) : null
    if (retrying) {
      // Re-answer the message that failed; don't store it twice.
    } else {
      const body = text.trim()
      if (!body) throw new Error('Type a message first.')
      chat.add({ role: 'user', content: body, roleId: openRole?.id ?? null })
    }

    const roles = rolesSvc.list()
    const system = buildSystemPrompt({ profile: await profileSvc.get(), roles, openRole })
    const messages = historyForModel(chat.list(200))
    const messageId = randomUUID()

    let full = ''
    let lastEmit = 0
    let pending: NodeJS.Timeout | null = null
    const flush = () => {
      pending = null
      lastEmit = Date.now()
      emit('chat:delta', { messageId, text: full })
    }
    try {
      const res = await ai.complete(
        { system, messages },
        {
          signal: controller.signal,
          onDelta: (d) => {
            if (controller.signal.aborted) return
            full += d
            const wait = DELTA_INTERVAL_MS - (Date.now() - lastEmit)
            if (wait <= 0) flush()
            else pending ??= setTimeout(flush, wait)
          },
        },
      )
      // Some providers don't stream; the result always has the whole text.
      if (res.text && res.text.length >= full.length) full = res.text
    } catch (err) {
      if (!controller.signal.aborted) throw err
    } finally {
      if (pending) clearTimeout(pending)
      if (current === controller) current = null
    }

    const stopped = controller.signal.aborted
    const parsed = parseReply(full, roleResolver(roles))
    if (!parsed.text && !parsed.actions.length && !stopped) throw new Error('The assistant sent back an empty reply. Try again.')
    return chat.add({ id: messageId, role: 'assistant', content: parsed.text, roleId: openRole?.id ?? null, actions: parsed.actions, stopped })
  })

  handle('chat:stop', () => {
    current?.abort()
  })

  handle('chat:applyAction', async ({ messageId, index }): Promise<ChatMessage> => {
    const msg = chat.get(messageId)
    const item = msg?.actions[index]
    if (!msg || !item) throw new Error('That suggestion is no longer available.')
    if (item.state === 'applied') return msg
    await applyAction(item.action, { roles: ctx.services.roles, profile: ctx.services.profile })
    return chat.setActionState(messageId, index, 'applied')
  })

  handle('chat:dismissAction', ({ messageId, index }) => chat.setActionState(messageId, index, 'dismissed'))

  handle('chat:clear', () => {
    current?.abort()
    chat.clear()
  })
}

export const chatFeature: Feature = {
  name: 'chat',
  migrations: chatMigrations,
  register,
}
