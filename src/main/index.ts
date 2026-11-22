import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { openStore } from './db/store'
import { Secrets, secretsMigration } from './secrets'
import { Settings, settingsMigration } from './settings'
import { features } from './features'
import { seedDemo } from './demo'
import { isHeadless } from './headless'
import { isSmoke, runSmoke } from './smoke'
import type { FeatureContext, Services } from './context'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Internship Tracker',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0e12' : '#f3f4f6',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: isHeadless(),
    },
  })
  if (!isHeadless()) win.once('ready-to-show', () => win.show())
  // Dev aids (screenshots) are ignored in packaged builds.
  const snapshot = app.isPackaged ? undefined : process.env['TRACKER_SNAPSHOT']
  if (snapshot) {
    // Dev aid: render, save a PNG of the window, quit. See scripts/snapshot.mjs.
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win.webContents.capturePage()
        writeFileSync(snapshot, img.toPNG())
        app.exit(0)
      }, Number(process.env['TRACKER_SNAPSHOT_DELAY'] ?? 1200))
    })
  }
  // Links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  const view = process.env['TRACKER_VIEW'] ?? ''
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (view ? `#view=${view}` : ''))
  else void win.loadFile(join(__dirname, '../renderer/index.html'), view ? { hash: `view=${view}` } : undefined)
  return win
}

app.setName('Internship Tracker')

// One instance at a time: two copies writing the same database would lose data.
// Screenshot runs use a throwaway demo database, so they may run side by side.
const demo = process.env['TRACKER_DEMO'] === '1'
if (!demo && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  void start()
}

async function start(): Promise<void> {
  if (isHeadless() && process.platform === 'darwin') app.setActivationPolicy('prohibited')
  await app.whenReady()
  // Dev aid: force a theme for screenshots (TRACKER_THEME=light|dark).
  const theme = process.env['TRACKER_THEME']
  if (theme === 'light' || theme === 'dark') nativeTheme.themeSource = theme
  const dataDir = app.getPath('userData')
  const store = await openStore(demo ? null : join(dataDir, 'tracker.sqlite'))
  store.migrate([settingsMigration, secretsMigration, ...features.flatMap((f) => f.migrations)])

  const secrets = new Secrets(store, { memory: demo })
  await secrets.load()
  const ctx: FeatureContext = {
    store,
    secrets,
    settings: new Settings(store),
    services: {} as Services,
    dataDir,
    mainWindow: () => mainWindow,
  }
  for (const f of features) f.register(ctx)
  if (demo) seedDemo(ctx.services.roles)

  mainWindow = createWindow()
  if (isSmoke()) runSmoke(mainWindow, { view: process.env['TRACKER_VIEW'] ?? '' })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    // Let queued keychain writes land before the final save.
    e.preventDefault()
    quitting = true
    void secrets.flush().finally(() => {
      store.flush()
      app.quit()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
