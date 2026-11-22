import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, dialog, shell, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { RESUME_EXTENSIONS, RESUME_MAX_BYTES, type ProfileStatus } from '@shared/profile'
import type { Feature, FeatureContext } from '../../context'
import { emit, handle } from '../../ipc'
import { seedDemoProfile } from './demo'
import { buildExport } from './export'
import { clearResumeFolder, importResume, ResumeError } from './resume'
import { EncryptedProfileService } from './service'

const isDemo = () => process.env['TRACKER_DEMO'] === '1'

/** Demo runs use a throwaway database, so their resume copy must not land in (or wipe) the real folder. */
function resumesDirFor(ctx: FeatureContext): string {
  return isDemo() ? join(tmpdir(), 'internship-tracker-demo', 'resumes') : join(ctx.dataDir, 'resumes')
}

async function openFile(ctx: FeatureContext, opts: OpenDialogOptions) {
  const win = ctx.mainWindow()
  return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)
}

async function saveFile(ctx: FeatureContext, opts: SaveDialogOptions) {
  const win = ctx.mainWindow()
  return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts)
}

export const profileFeature: Feature = {
  name: 'profile',
  migrations: [],
  register(ctx) {
    const resumesDir = resumesDirFor(ctx)
    const databasePath = join(ctx.dataDir, 'tracker.sqlite')
    const profile = new EncryptedProfileService({
      store: ctx.store,
      secrets: ctx.secrets,
      settings: ctx.settings,
      onChange: () => emit('profile:changed', {}),
    })
    ctx.services.profile = profile

    handle('profile:get', () => profile.get())
    handle('profile:save', (p) => profile.save(p))

    handle('profile:importResume', async () => {
      const res = await openFile(ctx, {
        title: 'Choose your resume',
        buttonLabel: 'Import',
        properties: ['openFile'],
        filters: [{ name: 'Resume (PDF, Word, text, Markdown)', extensions: [...RESUME_EXTENSIONS] }],
      })
      const file = res.canceled ? undefined : res.filePaths[0]
      if (!file) return null
      if (statSync(file).size > RESUME_MAX_BYTES) throw new ResumeError('That file is over 15 MB. Resumes are usually well under 1 MB; try exporting it again.')
      return importResume(profile, resumesDir, file, new Uint8Array(readFileSync(file)))
    })

    handle('profile:importResumeData', ({ fileName, data }) => importResume(profile, resumesDir, fileName, new Uint8Array(data)))

    handle('profile:removeResume', () => {
      clearResumeFolder(resumesDir)
      return profile.setResume(null)
    })

    handle('profile:exportAll', async () => {
      const date = new Date().toISOString().slice(0, 10)
      const res = await saveFile(ctx, {
        title: 'Export everything',
        buttonLabel: 'Export',
        defaultPath: join(app.getPath('downloads'), `internship-tracker-export-${date}.json`),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (res.canceled || !res.filePath) return null
      const data = buildExport({ store: ctx.store, profile, roles: ctx.services.roles })
      writeFileSync(res.filePath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
      return { path: res.filePath }
    })

    handle('profile:deleteAll', () => {
      // Every table (roles, chats, settings, encrypted secrets) is emptied and written to disk now.
      ctx.secrets.clear()
      ctx.store.wipe()
      clearResumeFolder(resumesDir)
      emit('profile:changed', {})
      emit('roles:changed', { ids: [] })
    })

    handle('profile:revealData', async () => {
      if (existsSync(databasePath)) return shell.showItemInFolder(databasePath)
      mkdirSync(ctx.dataDir, { recursive: true })
      const err = await shell.openPath(ctx.dataDir)
      if (err) throw new Error(`Couldn't open the data folder: ${err}`)
    })

    handle('profile:status', (): ProfileStatus => ({
      encrypted: profile.encrypted,
      dataDir: ctx.dataDir,
      databasePath: isDemo() ? null : databasePath,
      resumesDir,
      demo: isDemo(),
      platform: process.platform,
    }))

    if (isDemo()) seedDemoProfile(profile, resumesDir)
  },
}
