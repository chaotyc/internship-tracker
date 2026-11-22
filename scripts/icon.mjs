// Renders build/icon.svg to build/icon.png (1024x1024) with Electron, off-screen.
// electron-builder makes the .icns and .ico from that PNG.
// Usage: node scripts/icon.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = resolve(import.meta.dirname, '..')
const dir = mkdtempSync(join(tmpdir(), 'icon-'))
writeFileSync(
  join(dir, 'main.cjs'),
  `
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svg = readFileSync(${JSON.stringify(join(root, 'build/icon.svg'))}, 'utf8')
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  win.webContents.setZoomFactor(1)
  const html = '<html><body style="margin:0;background:transparent">' + svg.replace('<svg ', '<svg width="1024" height="1024" ') + '</body></html>'
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  writeFileSync(${JSON.stringify(join(root, 'build/icon.png'))}, img.resize({ width: 1024, height: 1024 }).toPNG())
  app.exit(0)
})
`,
)
const res = spawnSync(electron, [join(dir, 'main.cjs'), '--force-device-scale-factor=1'], { stdio: 'inherit' })
process.exit(res.status ?? 1)
