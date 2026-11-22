import { BrowserWindow, session, shell, type Session } from 'electron'
import { headlessWindowOptions, isHeadless } from '../../headless'
import { boardFromHtml, embedFormUrl, parseGreenhouseLink, type GreenhouseLink } from './url'

/** Applications share one persistent session, so a Greenhouse sign-in or cookie banner choice sticks. */
export const PARTITION = 'persist:applications'

let hardened: Session | null = null

function applicationSession(): Session {
  const ses = session.fromPartition(PARTITION)
  if (hardened !== ses) {
    // The site gets nothing: no camera, location, notifications or clipboard reads.
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    hardened = ses
  }
  return ses
}

/** A plain, locked-down browser window. No preload, so nothing from the app is exposed to the page. */
export function createApplicationWindow(title: string): BrowserWindow {
  const headless = headlessWindowOptions()
  const win = new BrowserWindow({
    width: 1180,
    height: 940,
    minWidth: 720,
    minHeight: 560,
    title,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      session: applicationSession(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: true,
      // Keeps timers running so filling continues if the window goes behind others.
      backgroundThrottling: false,
      ...headless.webPreferences,
    },
  })
  win.on('page-title-updated', (e) => e.preventDefault())
  // Popups (privacy policy, Dropbox, Google Drive) open in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isHeadless() && /^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!/^https?:\/\//.test(url)) e.preventDefault()
  })
  if (!isHeadless()) win.once('ready-to-show', () => win.show())
  return win
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** loadURL, tolerating ERR_ABORTED from a redirect or a page that navigates itself. */
async function load(win: BrowserWindow, url: string): Promise<void> {
  try {
    await win.loadURL(url)
  } catch (e) {
    if (!/ERR_ABORTED|\(-3\)/.test(String(e))) throw new Error(`Couldn't open the application page: ${(e as Error).message}`)
  }
}

/** Checks a guessed board token against Greenhouse's public job board API. */
async function boardHasJob(board: string, jobId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(jobId)}`, {
      signal: AbortSignal.timeout(6000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Loads the Greenhouse form for a link. Company pages that embed Greenhouse are
 * skipped in favor of the Greenhouse-hosted form, found from the board token.
 */
export async function loadApplication(win: BrowserWindow, link: GreenhouseLink): Promise<string> {
  if (link.kind !== 'company') {
    await load(win, link.formUrl)
    return link.formUrl
  }
  for (const board of link.boardGuesses) {
    if (await boardHasJob(board, link.jobId)) {
      const url = embedFormUrl(board, link.jobId)
      await load(win, url)
      return url
    }
  }
  // Load the company page and read the board from its Greenhouse iframe or embed script.
  await load(win, link.pageUrl).catch(() => {})
  for (let i = 0; i < 40; i++) {
    if (win.isDestroyed()) throw new Error('The application window was closed.')
    const found = (await win.webContents
      .executeJavaScriptInIsolatedWorld(4472, [
        {
          code: `(() => { const f = document.querySelector('#grnhse_iframe, iframe[src*="greenhouse.io"]'); return f ? f.src : document.documentElement.outerHTML.slice(0, 3000000) })()`,
        },
      ])
      .catch(() => '')) as string
    const src = /^https:\/\//.test(found) ? parseGreenhouseLink(found) : null
    if (src && src.kind !== 'company') {
      await load(win, src.formUrl)
      return src.formUrl
    }
    const board = boardFromHtml(found)
    if (board) {
      const url = embedFormUrl(board, link.jobId)
      await load(win, url)
      return url
    }
    await sleep(300)
  }
  throw new Error("Couldn't find the Greenhouse form on that page. Open the posting and use its Apply link instead.")
}
