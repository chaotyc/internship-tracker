#!/usr/bin/env node
// Builds the app, then renders each view off-screen with the demo board and saves PNGs.
// Usage: node scripts/snapshot.mjs [view ...]
//   views (default: board add role settings chat):
//          board today suggestions skipped add role chat
//          settings settings-tracks settings-ai settings-boards settings-email settings-data
//          onboarding onboarding-ai onboarding-profile onboarding-roles onboarding-done
// Env: SNAPSHOT_NAME=<name> builds into out-<name>/ and writes screenshots/<name>/
//      (default: out-snapshot/ and screenshots/), so several people (or agents) can
//      take screenshots at the same time without touching the out/ folder.
//      TRACKER_WINDOW=960x600 sets the window size (e.g. the smallest the app allows).
//      THEME=light|dark|both forces the theme (default: follow the system). With
//      both, each view is saved twice as <view>-light.png and <view>-dark.png.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import electron from 'electron'

const views = process.argv.slice(2).length ? process.argv.slice(2) : ['board', 'add', 'role', 'settings', 'chat']
const name = process.env.SNAPSHOT_NAME
const outDir = `out-${name ?? 'snapshot'}`
const shots = join(process.cwd(), 'screenshots', name ?? '')
mkdirSync(shots, { recursive: true })
// npx is a .cmd file on Windows, which only runs through a shell.
execFileSync('npx', ['electron-vite', 'build', '--outDir', outDir], { stdio: 'inherit', shell: process.platform === 'win32' })
const themes = process.env.THEME === 'both' ? ['light', 'dark'] : [process.env.THEME ?? '']
let failed = 0
for (const view of views) {
  for (const theme of themes) {
    const file = join(shots, `${view}${process.env.THEME === 'both' ? `-${theme}` : ''}.png`)
    const res = spawnSync(electron, [join(outDir, 'main', 'index.js')], {
      stdio: 'inherit',
      env: { ...process.env, TRACKER_DEMO: '1', TRACKER_SNAPSHOT: file, TRACKER_THEME: theme, TRACKER_VIEW: view === 'board' ? '' : view },
      // A view that never finishes loading would otherwise hang the script.
      timeout: 120_000,
    })
    if (res.status !== 0) failed++
    console.log(res.status === 0 ? `saved ${file}` : `failed ${view}${theme ? ` (${theme})` : ''}`)
  }
}
process.exit(failed ? 1 : 0)
