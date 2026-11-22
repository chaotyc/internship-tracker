import type { BrowserWindow } from 'electron'
import { BOARD_NAMES, type AutofillEvents, type AutofillReport, type AutofillStep } from '@shared/autofill'
import type { Feature } from '../../context'
import { handle } from '../../ipc'
import { isHeadless } from '../../headless'
import { adapterFor, detectLink } from './boards'
import { isProfileEmpty } from './match'
import { prepareFill } from './prepare'
import { fillApplication } from './runner'
import { createApplicationWindow, loadApplication } from './window'

/**
 * Autofill for Greenhouse, Ashby and Lever: opens the application in its own
 * locked-down window, fills it from the profile and the role's track resume, and
 * stops. The user reviews and submits.
 */
export const autofillFeature: Feature = {
  name: 'autofill',
  migrations: [],
  register(ctx) {
    const windows = new Map<string, BrowserWindow>()
    const running = new Set<string>()

    // Events go to the app window only, never to an application page.
    const send = <E extends keyof AutofillEvents>(event: E, payload: AutofillEvents[E]) => {
      const w = ctx.mainWindow()
      if (w && !w.isDestroyed()) w.webContents.send(event, payload)
    }
    const progress = (roleId: string, step: AutofillStep, message: string) => send('autofill:progress', { roleId, step, message })

    handle('autofill:supported', ({ url }) => {
      const link = detectLink(url)
      return { supported: !!link, board: link?.board ?? '' }
    })

    handle('autofill:open', async ({ roleId }) => {
      const role = ctx.services.roles.get(roleId)
      if (!role) throw new Error('That role no longer exists.')
      const link = detectLink(role.link)
      if (!link) throw new Error('Autofill works with Greenhouse, Ashby and Lever application links.')
      const adapter = adapterFor(link.board)
      const { profile, resume, resumeTrack } = prepareFill(ctx.services.profile, role)
      const base: AutofillReport = {
        roleId,
        url: role.link,
        board: link.board,
        filled: [],
        needsYou: [],
        resumeAttached: false,
        resumeFile: null,
        profileEmpty: false,
        notes: [],
      }
      if (isProfileEmpty(profile)) return { ...base, board: '', profileEmpty: true }
      if (running.has(roleId)) throw new Error('Autofill is already working on this application.')

      running.add(roleId)
      try {
        let win = windows.get(roleId)
        let url = role.link
        if (win && !win.isDestroyed()) {
          // Already open: fill whatever is still empty on the current page (the runner checks it's still the form).
          if (!isHeadless()) win.focus()
          url = win.webContents.getURL()
        } else {
          progress(roleId, 'opening', `Opening the ${BOARD_NAMES[link.board]} application…`)
          win = createApplicationWindow(`Apply: ${role.company} – ${role.title}`)
          windows.set(roleId, win)
          win.on('closed', () => windows.delete(roleId))
          url = await loadApplication(win, link)
        }
        const result = await fillApplication(win.webContents, adapter, profile, resume, (step, message) => progress(roleId, step, message))
        const notes = [...result.notes]
        if (result.resumeFile && resumeTrack) notes.unshift(`Attached ${result.resumeFile}, the resume for your ${resumeTrack} track.`)
        const report: AutofillReport = { ...base, url, ...result, notes }
        progress(roleId, 'done', `Filled ${report.filled.length} fields.`)
        send('autofill:report', report)
        return report
      } catch (e) {
        const message = (e as Error).message || String(e)
        progress(roleId, 'failed', message)
        throw new Error(/destroyed|closed|disposed/i.test(message) ? 'The application window was closed.' : message)
      } finally {
        running.delete(roleId)
      }
    })
  },
}
