import type { Feature } from '../../context'
import { handle } from '../../ipc'

// TODO(search feature): job-board clients, autosearch ranking and the expiry refresh.
export const searchFeature: Feature = {
  name: 'search',
  migrations: [],
  register() {
    const notYet = (): never => {
      throw new Error('Autosearch is not built yet.')
    }
    handle('search:watchlist', () => [])
    handle('search:saveWatchlist', (list) => list)
    handle('search:detectBoard', () => null)
    handle('search:run', notYet)
    handle('search:cancel', () => undefined)
    handle('search:suggestions', () => [])
    handle('search:addSuggestion', notYet)
    handle('search:dismissSuggestion', () => undefined)
    handle('search:fromLink', notYet)
    handle('search:refresh', (): never => {
      throw new Error('Refresh is not built yet.')
    })
  },
}
