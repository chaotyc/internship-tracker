import type { BrowserWindow } from 'electron'
import type { AutofillEvents, AutofillReport, AutofillStep } from '@shared/autofill'
import type { Feature } from '../../context'
import { handle } from '../../ipc'
import { isHeadless } from '../../headless'
import { isProfileEmpty } from './match'
import { fillApplication } from './runner'
import { parseGreenhouseLink } from './url'
import { createApplicationWindow, loadApplication } from './window'

/**
 * Greenhouse autofill: opens the application in its own locked-down window,
 * fills it from the profile and stops. The user reviews and submits.
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
      const supported = !!parseGreenhouseLink(url)
      return { supported, board: supported ? 'greenhouse' : '' }
    })

    handle('autofill:open', async ({ roleId }) => {
      const role = ctx.services.roles.get(roleId)
      if (!role) throw new Error('That role no longer exists.')
      const link = parseGreenhouseLink(role.link)
      if (!link) throw new Error('Autofill works with Greenhouse application links.')
      const profile = ctx.services.profile.get()
      const base: AutofillReport = { roleId, url: role.link, filled: [], needsYou: [], resumeAttached: false, profileEmpty: false, notes: [] }
      if (isProfileEmpty(profile)) return { ...base, profileEmpty: true }
      if (running.has(roleId)) throw new Error('Autofill is already working on this application.')

      running.add(roleId)
      try {
        let win = windows.get(roleId)
        let url = role.link
        if (win && !win.isDestroyed()) {
          // Already open: fill whatever is still empty on the current page.
          if (!isHeadless()) win.focus()
          url = win.webContents.getURL()
        } else {
          progress(roleId, 'opening', 'Opening the application…')
          win = createApplicationWindow(`Apply: ${role.company} – ${role.title}`)
          windows.set(roleId, win)
          win.on('closed', () => windows.delete(roleId))
          url = await loadApplication(win, link)
        }
        const result = await fillApplication(win.webContents, profile, (step, message) => progress(roleId, step, message))
        const report: AutofillReport = { ...base, url, ...result }
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
