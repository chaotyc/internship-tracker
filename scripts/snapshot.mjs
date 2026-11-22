#!/usr/bin/env node
// Builds the app, then renders each view with demo data and saves PNGs.
// Usage: node scripts/snapshot.mjs [view ...]
//   views: board add role settings settings-ai settings-boards settings-data chat
// Env: SNAPSHOT_NAME=<name> builds into out-<name>/ and writes screenshots/<name>/,
//      so several people (or agents) can take screenshots at the same time.
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
for (const view of views) {
  const file = join(shots, `${view}.png`)
  const res = spawnSync(electron, [join(outDir, 'main', 'index.js')], {
    stdio: 'inherit',
    env: { ...process.env, TRACKER_DEMO: '1', TRACKER_SNAPSHOT: file, TRACKER_VIEW: view === 'board' ? '' : view },
  })
  console.log(res.status === 0 ? `saved ${file}` : `failed ${view}`)
}
