import type { Feature } from '../../context'
import { handle } from '../../ipc'

// TODO(autofill feature): Greenhouse application window that fills from the profile.
export const autofillFeature: Feature = {
  name: 'autofill',
  migrations: [],
  register() {
    handle('autofill:supported', ({ url }) => ({ supported: false, board: /greenhouse/.test(url) ? 'greenhouse' : '' }))
    handle('autofill:open', (): never => {
      throw new Error('Autofill is not built yet.')
    })
  },
}
