import type { Feature } from '../../context'
import { handle } from '../../ipc'
import { StubProfileService } from './service'

// TODO(profile feature): encrypted storage, resume import, export and delete-all.
export const profileFeature: Feature = {
  name: 'profile',
  migrations: [],
  register(ctx) {
    const profile = new StubProfileService(ctx.settings)
    ctx.services.profile = profile
    handle('profile:get', () => profile.get())
    handle('profile:save', (p) => profile.save(p))
    handle('profile:importResume', () => null)
    handle('profile:exportAll', () => null)
    handle('profile:deleteAll', () => ctx.store.wipe())
  },
}
