import type { BrowserWindow } from 'electron'
import type { Migration, Store } from './db/store'
import type { Secrets } from './secrets'
import type { Settings } from './settings'
import type { AiService } from './features/ai/service'
import type { ProfileService } from './features/profile/service'
import type { RolesService } from './features/roles/service'

/** Services features expose to each other. Set during registration, in feature order. */
export interface Services {
  roles: RolesService
  profile: ProfileService
  ai: AiService
}

export interface FeatureContext {
  store: Store
  secrets: Secrets
  settings: Settings
  services: Services
  /** Electron's userData folder; files the app keeps (resume copies) go under it. */
  dataDir: string
  mainWindow: () => BrowserWindow | null
}

export interface Feature {
  name: string
  migrations: Migration[]
  register(ctx: FeatureContext): void
}
