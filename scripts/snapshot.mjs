#!/usr/bin/env node
// Builds the app, then renders each view with demo data and saves PNGs to ./screenshots.
// Usage: node scripts/snapshot.mjs [view ...]   views: board add role settings settings-ai settings-boards chat
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import electron from 'electron'

const views = process.argv.slice(2).length ? process.argv.slice(2) : ['board', 'add', 'role', 'settings', 'chat']
const out = join(process.cwd(), 'screenshots')
mkdirSync(out, { recursive: true })
execFileSync('npx', ['electron-vite', 'build'], { stdio: 'inherit' })
for (const view of views) {
  const file = join(out, `${view}.png`)
  const res = spawnSync(electron, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, TRACKER_DEMO: '1', TRACKER_SNAPSHOT: file, TRACKER_VIEW: view === 'board' ? '' : view },
  })
  console.log(res.status === 0 ? `saved ${file}` : `failed ${view}`)
}
