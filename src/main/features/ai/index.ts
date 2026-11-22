import { isProviderId, type ProviderId } from '@shared/ai'
import type { Feature } from '../../context'
import { handle } from '../../ipc'
import { discoverNpmGlobalBin } from './cli-runner'
import { AiServiceImpl } from './service'

function providerArg(x: unknown): ProviderId {
  if (!isProviderId(x)) throw new Error('Unknown AI connection.')
  return x
}

export const aiFeature: Feature = {
  name: 'ai',
  migrations: [],
  register(ctx) {
    const ai = new AiServiceImpl({ secrets: ctx.secrets, settings: ctx.settings })
    ctx.services.ai = ai
    // Finds CLIs installed under a custom npm prefix; the fixed folders cover the rest meanwhile.
    void discoverNpmGlobalBin().then(() => ai.presence.clear())

    handle('ai:status', () => {
      // Opening the panel re-checks, so a CLI installed a moment ago shows up.
      ai.presence.clear()
      return ai.status()
    })
    handle('ai:getSettings', () => ai.getSettings())
    handle('ai:saveSettings', (s) => ai.saveSettings(s))
    handle('ai:setKey', ({ provider, key }) => {
      ai.setKey(providerArg(provider), key)
      return ai.status()
    })
    handle('ai:clearKey', ({ provider }) => {
      ai.clearKey(providerArg(provider))
      return ai.status()
    })
    handle('ai:test', ({ provider }) => ai.test(providerArg(provider)))
  },
}
