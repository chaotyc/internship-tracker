import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from 'electron'
import { openStore } from './db/store'
import { Secrets, secretsMigration } from './secrets'
import { Settings, settingsMigration } from './settings'
import { features } from './features'
import { seedDemo } from './demo'
import { isHeadless, makeThrowawayDir, removeThrowawayDir } from './headless'
import { installMenu } from './menu'
import { isSmoke, runSmoke } from './smoke'
import type { FeatureContext, Services } from './context'

let mainWindow: BrowserWindow | null = null

/** Dev aid: TRACKER_WINDOW=960x600 sets the window size, to check narrow layouts in screenshots. */
function windowSize(): { width: number; height: number } {
  const m = app.isPackaged ? null : /^(\d{3,4})x(\d{3,4})$/.exec(process.env['TRACKER_WINDOW'] ?? '')
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1440, height: 900 }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...windowSize(),
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Internship Tracker',
    // Windows and Linux: the menu bar shows when Alt is pressed.
    autoHideMenuBar: process.platform !== 'darwin',
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
      // Off-screen windows can stop mid-animation (a dialog caught half faded in), so screenshots skip motion.
      void win.webContents.insertCSS('*, *::before, *::after, ::backdrop { animation: none !important; transition: none !important; }')
      setTimeout(async () => {
        const img = await win.webContents.capturePage()
        writeFileSync(snapshot, img.toPNG())
        removeThrowawayDir()
        app.exit(0)
      }, Number(process.env['TRACKER_SNAPSHOT_DELAY'] ?? 1200))
    })
  }
  // Links open in the user's browser, never inside the app. The app page itself never navigates.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url === win.webContents.getURL()) return
    e.preventDefault()
    openInBrowser(url)
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  const view = process.env['TRACKER_VIEW'] ?? ''
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (view ? `#view=${view}` : ''))
  else void win.loadFile(join(__dirname, '../renderer/index.html'), view ? { hash: `view=${view}` } : undefined)
  return win
}

/** Opens a web link in the user's browser. Anything that isn't http(s) is ignored. */
function openInBrowser(raw: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return
  }
  if ((url.protocol === 'https:' || url.protocol === 'http:') && !isHeadless()) void shell.openExternal(url.toString())
}

app.setName('Internship Tracker')

const demo = process.env['TRACKER_DEMO'] === '1'

// Dev and test hooks. A packaged build never loads a dev server or takes screenshots, and
// only the CI smoke test (which needs the throwaway demo database) may run it off-screen.
if (app.isPackaged) {
  for (const k of ['ELECTRON_RENDERER_URL', 'TRACKER_SNAPSHOT', 'TRACKER_WINDOW']) delete process.env[k]
  if (!demo) for (const k of ['TRACKER_HEADLESS', 'TRACKER_SMOKE']) delete process.env[k]
}

// Demo runs (screenshots, smoke tests) get their own throwaway browser profile, so they never
// touch the real app folder (window state, cookies from application sites) or a running copy.
if (demo) {
  app.setPath('userData', makeThrowawayDir())
  app.on('will-quit', removeThrowawayDir)
}

// Defense in depth for every web page the app creates: no <webview>, no pop-up windows.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

// One instance at a time: two copies writing the same database would lose data.
// Demo runs use a throwaway database and profile folder, so they may run side by side.
if (!demo && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!app.isReady()) return
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  start().catch((err: unknown) => {
    // A database that can't be opened (damaged file, full disk) must not leave a windowless app running.
    console.error('[start] failed:', err)
    const file = join(app.getPath('userData'), 'tracker.sqlite')
    if (!isHeadless()) {
      dialog.showErrorBox(
        "Internship Tracker couldn't start",
        `${err instanceof Error ? err.message : String(err)}\n\nYour data is in ${file}. It has not been changed. Make a copy of it before trying again, and report the problem if it keeps happening.`,
      )
    }
    removeThrowawayDir()
    app.exit(1)
  })
}

/** Waits for pending keychain writes, but never blocks quitting for more than a few seconds. */
function settle(p: Promise<void>, ms: number): Promise<void> {
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))])
}

async function start(): Promise<void> {
  if (isHeadless() && process.platform === 'darwin') app.setActivationPolicy('prohibited')
  await app.whenReady()
  installMenu()
  // The app's own pages need no browser permissions (camera, notifications, location...).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
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
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
  })
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    // Let queued keychain writes land before the final save.
    e.preventDefault()
    quitting = true
    void settle(secrets.flush(), 5000).finally(() => {
      try {
        store.flush()
      } catch (err) {
        console.error('[store] final save failed:', err)
      }
      app.quit()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
