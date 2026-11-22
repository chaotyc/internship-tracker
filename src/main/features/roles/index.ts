import type { Feature } from '../../context'
import { handle } from '../../ipc'
import { rolesFromCsv } from './csv'
import { RolesService, rolesMigrations } from './service'

export const rolesFeature: Feature = {
  name: 'roles',
  migrations: rolesMigrations,
  register(ctx) {
    const roles = new RolesService(ctx.store)
    ctx.services.roles = roles
    handle('roles:list', () => roles.list())
    handle('roles:create', (input) => roles.create({ ...input, source: input.source ?? 'manual' }))
    handle('roles:update', ({ id, patch }) => roles.update(id, patch))
    handle('roles:delete', ({ id }) => roles.delete(id))
    handle('roles:move', ({ id, stage, index }) => roles.move(id, stage, index))
    handle('roles:importCsv', ({ csv }) => roles.createMany(rolesFromCsv(csv)))
  },
}
