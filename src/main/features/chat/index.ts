import type { Feature } from '../../context'
import { handle } from '../../ipc'

// TODO(chat feature): conversation storage, streaming replies and proposed actions.
export const chatFeature: Feature = {
  name: 'chat',
  migrations: [],
  register() {
    const notYet = (): never => {
      throw new Error('The assistant is not built yet.')
    }
    handle('chat:history', () => [])
    handle('chat:send', notYet)
    handle('chat:stop', () => undefined)
    handle('chat:applyAction', notYet)
    handle('chat:dismissAction', notYet)
    handle('chat:clear', () => undefined)
  },
}
