import { version } from '../../package.json'

/**
 * The app's version from package.json, built in. Electron's app.getVersion() reports Electron's own
 * version when the app isn't started from its folder (screenshot and smoke runs), so use this instead.
 */
export const APP_VERSION: string = version
