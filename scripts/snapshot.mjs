#!/usr/bin/env node
// Builds the app, then renders each view with demo data and saves PNGs.
// Usage: node scripts/snapshot.mjs [view ...]
//   views: board add role settings settings-ai settings-boards settings-data chat
// Env: SNAPSHOT_NAME=<name> builds into out-<name>/ and writes screenshots/<name>/,
//      so several people (or agents) can take screenshots at the same time.
//      THEME=light|dark|both forces the theme (default: follow the system). With
//      both, each view is saved twice as <view>-light.png and <view>-dark.png.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import electron from 'electron'

const views = process.argv.slice(2).length ? process.argv.slice(2) : ['board', 'add', 'role', 'settings', 'chat']
const name = process.env.SNAPSHOT_NAME
const outDir = name ? `out-${name}` : 'out'
const shots = join(process.cwd(), 'screenshots', name ?? '')
mkdirSync(shots, { recursive: true })
execFileSync('npx', ['electron-vite', 'build', '--outDir', outDir], { stdio: 'inherit' })
const themes = process.env.THEME === 'both' ? ['light', 'dark'] : [process.env.THEME ?? '']
for (const view of views) {
  for (const theme of themes) {
    const file = join(shots, `${view}${process.env.THEME === 'both' ? `-${theme}` : ''}.png`)
    const res = spawnSync(electron, [join(outDir, 'main', 'index.js')], {
      stdio: 'inherit',
      env: { ...process.env, TRACKER_DEMO: '1', TRACKER_SNAPSHOT: file, TRACKER_THEME: theme, TRACKER_VIEW: view === 'board' ? '' : view },
    })
    console.log(res.status === 0 ? `saved ${file}` : `failed ${view}`)
  }
}
