// Launches the packaged app (from `electron-builder --dir`) off-screen with the demo
// board, once per view, and checks that each view renders. Saves a screenshot of each
// view to release/smoke/. Exits non-zero if any view fails.
//
// Usage: npm run dist -- --dir && node scripts/smoke.mjs [views...]
// Linux without a display: run under xvfb-run.
//
// SMOKE_EXPECT_KEYCHAIN=ok|unavailable also checks the OS keychain (encrypt and
// decrypt a value) and fails if the result differs. Leave it unset on your own
// computer: the check can trigger a keychain permission prompt there.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const release = join(root, 'release')
const outDir = join(release, 'smoke')
const expectKeychain = process.env['SMOKE_EXPECT_KEYCHAIN'] ?? ''
const views = process.argv.slice(2).length ? process.argv.slice(2) : ['board', 'today', 'suggestions', 'role', 'chat', 'settings', 'settings-ai']

function findApp() {
  if (!existsSync(release)) throw new Error('No release/ folder. Build first: npm run dist -- --dir')
  const dirs = readdirSync(release)
  if (process.platform === 'darwin') {
    const dir = dirs.find((d) => d === `mac-${process.arch}`) ?? dirs.find((d) => d.startsWith('mac'))
    if (dir) return join(release, dir, 'Internship Tracker.app', 'Contents', 'MacOS', 'Internship Tracker')
  } else if (process.platform === 'win32') {
    const dir = dirs.find((d) => d.startsWith('win') && d.endsWith('unpacked'))
    if (dir) return join(release, dir, 'Internship Tracker.exe')
  } else {
    const dir = dirs.find((d) => d.startsWith('linux') && d.endsWith('unpacked'))
    if (dir) return join(release, dir, 'internship-tracker')
  }
  throw new Error(`No unpacked app for ${process.platform} in release/ (found: ${dirs.join(', ')})`)
}

function run(app, view) {
  return new Promise((done) => {
    const png = join(outDir, `${process.platform}-${view}.png`)
    const child = spawn(app, [], {
      env: {
        ...process.env,
        TRACKER_DEMO: '1',
        TRACKER_SMOKE: '1',
        TRACKER_SMOKE_PNG: png,
        TRACKER_VIEW: view === 'board' ? '' : view,
        TRACKER_THEME: 'light',
        ...(expectKeychain ? { TRACKER_SMOKE_KEYCHAIN: '1' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => child.kill(), 60_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      const line = out.split('\n').find((l) => l.startsWith('SMOKE '))
      let result = null
      try {
        result = line ? JSON.parse(line.slice(6)) : null
      } catch {
        result = null
      }
      done({ view, code, result, stderr: err.trim().split('\n').slice(-15).join('\n') })
    })
  })
}

const app = findApp()
mkdirSync(outDir, { recursive: true })
console.log(`Smoke testing ${app}`)
let failed = 0
for (const view of views) {
  const { code, result, stderr } = await run(app, view)
  const keychainOk = !expectKeychain || (expectKeychain === 'ok' ? result?.keychain === true : result?.keychain === false)
  const ok = code === 0 && result?.ok && keychainOk
  if (!ok) failed++
  const detail = result
    ? `found ${result.found}, ${result.ms} ms, keychain ${result.keychain == null ? 'not checked' : result.keychain ? 'ok' : 'unavailable'}${result.storageBackend ? ` (${result.storageBackend})` : ''}`
    : 'no result'
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${view.padEnd(12)} ${detail}`)
  if (result?.notes?.length) console.log(`      notes: ${result.notes.join('; ')}`)
  if (result?.errors?.length) console.log(`      console errors:\n        ${result.errors.join('\n        ')}`)
  if (!keychainOk) console.log(`      expected keychain ${expectKeychain}, got ${result?.keychain}`)
  if (!ok && stderr) console.log(`      stderr:\n${stderr.replace(/^/gm, '        ')}`)
}
console.log(failed ? `${failed} of ${views.length} views failed` : `All ${views.length} views rendered. Screenshots in ${outDir}`)
process.exit(failed ? 1 : 0)
