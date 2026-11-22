import type { Feature } from '../../context'
import { handle } from '../../ipc'
import { StubAiService } from './service'

// TODO(ai feature): replace the stub with CLI + API providers.
export const aiFeature: Feature = {
  name: 'ai',
  migrations: [],
  register(ctx) {
    const ai = new StubAiService()
    ctx.services.ai = ai
    handle('ai:status', () => ai.status())
    handle('ai:getSettings', () => ({ defaultProvider: null, models: {} }))
    handle('ai:saveSettings', (s) => s)
    handle('ai:setKey', () => ai.status())
    handle('ai:clearKey', () => ai.status())
    handle('ai:test', () => ({ ok: false, detail: 'AI connections are not built yet.' }))
  },
}
