import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { openStore } from './db/store'
import { Secrets, secretsMigration } from './secrets'
import { Settings, settingsMigration } from './settings'
import { features } from './features'
import { seedDemo } from './demo'
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
    backgroundColor: '#f4f5f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  const snapshot = process.env['TRACKER_SNAPSHOT']
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

async function start(): Promise<void> {
  await app.whenReady()
  const dataDir = app.getPath('userData')
  const demo = process.env['TRACKER_DEMO'] === '1'
  const store = await openStore(demo ? null : join(dataDir, 'tracker.sqlite'))
  store.migrate([settingsMigration, secretsMigration, ...features.flatMap((f) => f.migrations)])

  const ctx: FeatureContext = {
    store,
    secrets: new Secrets(store),
    settings: new Settings(store),
    services: {} as Services,
    dataDir,
    mainWindow: () => mainWindow,
  }
  for (const f of features) f.register(ctx)
  if (demo) seedDemo(ctx.services.roles)

  mainWindow = createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
  app.on('before-quit', () => store.flush())
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

void start()
