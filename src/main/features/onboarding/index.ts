import { isOnboardingStep, type OnboardingStatus } from '@shared/onboarding'
import type { Feature } from '../../context'
import { handle } from '../../ipc'
import { readState, shouldShow, writeState } from './state'

const isDemo = () => process.env['TRACKER_DEMO'] === '1'

export const onboardingFeature: Feature = {
  name: 'onboarding',
  migrations: [],
  register(ctx) {
    const status = (): OnboardingStatus => {
      const demo = isDemo()
      let state = readState(ctx.settings)
      const roleCount = ctx.services.roles?.list().length ?? 0
      // A board from before the tour existed: remember it, so emptying the board later doesn't bring the tour up.
      if (!state && !demo && roleCount > 0) state = writeState(ctx.settings, { outcome: 'existing', at: new Date().toISOString(), step: null })
      return { show: shouldShow({ state, demo, roleCount }), state, canStoreKeys: ctx.secrets.available, demo }
    }

    handle('onboarding:status', status)
    handle('onboarding:finish', ({ outcome, step }) => {
      if (outcome !== 'completed' && outcome !== 'skipped') throw new Error('Unknown tour outcome.')
      writeState(ctx.settings, { outcome, at: new Date().toISOString(), step: isOnboardingStep(step) ? step : null })
      return status()
    })
  },
}
