import { existsSync } from 'node:fs'
import type { WebContents } from 'electron'
import type { Profile } from '@shared/profile'
import type { AutofillField } from '@shared/autofill'
import type { FieldDescriptor } from './fields'
import { chooseOption, classify, planFill, type FillAction } from './match'
import { INSTALL_AGENT } from './page'

/** Isolated world for the page agent; the site's scripts can't reach it. */
const WORLD = 4471

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface RunResult {
  filled: AutofillField[]
  needsYou: string[]
  resumeAttached: boolean
  notes: string[]
}

/** Calls a method of the in-page agent with JSON arguments. */
class Page {
  constructor(private readonly wc: WebContents) {}

  async install(): Promise<void> {
    await this.wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: INSTALL_AGENT }])
  }

  async call<T>(method: string, ...args: unknown[]): Promise<T> {
    if (this.wc.isDestroyed()) throw new Error('The application window was closed.')
    const code = `globalThis.__trackerAutofill.${method}(...${JSON.stringify(args)})`
    return (await this.wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }])) as T
  }
}

/** Trusted keyboard input through the DevTools protocol. react-select ignores synthetic key events. */
class Input {
  attached = false
  constructor(private readonly wc: WebContents) {}

  attach(): boolean {
    try {
      if (!this.wc.debugger.isAttached()) this.wc.debugger.attach('1.3')
      this.attached = true
    } catch {
      this.attached = false
    }
    return this.attached
  }

  detach(): void {
    try {
      if (this.wc.debugger.isAttached()) this.wc.debugger.detach()
    } catch {
      /* already gone */
    }
    this.attached = false
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.wc.debugger.sendCommand(method, params) as Promise<T>
  }

  /** Only navigation keys. Never Enter, which could submit the form. */
  async key(key: 'ArrowDown' | 'Escape'): Promise<void> {
    const code = key === 'ArrowDown' ? 40 : 27
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
  }

  async type(text: string): Promise<void> {
    await this.send('Input.insertText', { text })
  }
}

interface Menu {
  open: boolean
  options: string[]
  loading: boolean
}

/**
 * Fills the Greenhouse form loaded in `wc` from the profile. Collects field
 * descriptors in the page, decides values with match.ts, applies them, attaches
 * the resume, then draws the review banner. Never submits.
 */
export async function fillApplication(wc: WebContents, profile: Profile, onStep: (step: 'filling' | 'resume', message: string) => void): Promise<RunResult> {
  const page = new Page(wc)
  const input = new Input(wc)
  const done: { key: string; label: string; value: string }[] = []
  const notes: string[] = []
  await page.install()
  const ready = await page.call<boolean>('waitForForm')
  if (!ready) throw new Error("Couldn't find the application form on this page.")
  await waitForHydration(wc)

  input.attach()
  if (!input.attached) notes.push('Dropdowns and the resume were skipped because developer tools are open on that window.')
  await page.call('guard', true)
  try {
    onStep('filling', 'Filling in your details…')
    const handled = new Set<string>()
    // Answers can reveal follow-up questions (e.g. race after Hispanic/Latino), so look again after each pass.
    for (let pass = 0; pass < 3; pass++) {
      const fields = (await page.call<FieldDescriptor[]>('collect')).filter((f) => !handled.has(f.key))
      if (input.attached) await readComboOptions(page, input, fields, profile)
      const plan = planFill(fields, profile)
      if (!plan.actions.length) break
      for (const a of plan.actions) {
        handled.add(a.key)
        const value = await apply(page, input, a)
        if (value) done.push({ key: a.key, label: a.label || a.what, value })
      }
    }

    // Report what the form shows now: sites reformat values (phones) or reset linked answers
    // (declining race can reset Hispanic/Latino), and a hidden follow-up no longer counts.
    const filled: AutofillField[] = []
    const seen = new Set<string>()
    for (const d of done) {
      const now = await page.call<string>('valueOf', d.key).catch(() => '')
      // A phone country shows as "+1" but was chosen as "United States +1"; keep the clearer text.
      const value = d.value.includes(now) ? d.value : now
      if (!now.trim() || seen.has(`${d.label}\n${value}`)) continue
      seen.add(`${d.label}\n${value}`)
      filled.push({ label: d.label, value })
    }

    const resume = profile.resume
    let resumeAttached = false
    if (resume?.storedPath) {
      onStep('resume', 'Attaching your resume…')
      if (!existsSync(resume.storedPath)) notes.push('Your saved resume file is missing. Upload it again in Settings > Profile.')
      else if (!input.attached) notes.push('Attach your resume yourself.')
      else resumeAttached = await attachResume(page, input, resume.storedPath, resume.fileName)
      if (!resumeAttached && existsSync(resume.storedPath) && input.attached) notes.push("Couldn't attach your resume; attach it yourself.")
    } else {
      notes.push('No resume saved in your profile.')
    }

    const empties = await page.call<{ key: string; label: string }[]>('requiredEmpty')
    await page.call('banner', { filled: filled.length, needs: empties, resume: resume?.storedPath ? (resumeAttached ? 'attached' : 'missing') : '' })
    return { filled, needsYou: [...new Set(empties.map((e) => e.label))], resumeAttached, notes }
  } finally {
    await page.call('guard', false).catch(() => {})
    input.detach()
  }
}

/**
 * Greenhouse renders the form on the server and React takes it over a moment later;
 * values set before that are thrown away and dropdowns don't respond. This only
 * reads whether React has attached to the first field (main world, read-only).
 */
async function waitForHydration(wc: WebContents): Promise<void> {
  const probe = `(() => { const el = document.querySelector('#first_name, form input'); return !!el && Object.keys(el).some((k) => k.startsWith('__react')) })()`
  for (let i = 0; i < 30; i++) {
    if (await wc.executeJavaScript(probe).catch(() => false)) {
      await sleep(300)
      return
    }
    await sleep(200)
  }
}

/** Opens each combobox we have a value for and records its options, so matching can choose exactly. */
async function readComboOptions(page: Page, input: Input, fields: FieldDescriptor[], profile: Profile): Promise<void> {
  for (const f of fields) {
    if (f.kind !== 'combobox' || f.hasValue || f.options.length || !classify(f, profile)) continue
    if (!(await page.call<boolean>('focus', f.key))) continue
    await input.key('ArrowDown')
    const m = await waitMenu(page, f.key, 1200)
    f.options = m.options
    await input.key('Escape')
    await page.call('blur', f.key)
  }
}

async function waitMenu(page: Page, key: string, timeout: number, minWait = 0): Promise<Menu> {
  const start = Date.now()
  if (minWait) await sleep(minWait)
  let last: Menu = { open: false, options: [], loading: false }
  let prev = ''
  for (;;) {
    last = await page.call<Menu>('menu', key)
    const sig = last.options.join('\n')
    // Done when options have arrived and stopped changing (async searches update in bursts).
    if (last.options.length && !last.loading && sig === prev) return last
    prev = sig
    if (Date.now() - start > timeout) return last
    await sleep(150)
  }
}

async function apply(page: Page, input: Input, a: FillAction): Promise<string | null> {
  switch (a.kind) {
    case 'select':
      return a.value && (await page.call<boolean>('setSelect', a.key, a.value)) ? a.value : null
    case 'radio':
    case 'checkboxes':
    case 'checkbox':
      return a.value && (await page.call<boolean>('check', a.key, a.value)) ? (a.kind === 'checkbox' ? 'Checked' : a.value) : null
    case 'combobox':
      return input.attached ? applyCombo(page, input, a) : null
    case 'file':
      return null
    default:
      return a.value && (await page.call<boolean>('setText', a.key, a.value)) ? a.value : null
  }
}

async function applyCombo(page: Page, input: Input, a: FillAction): Promise<string | null> {
  if (!(await page.call<boolean>('focus', a.key))) return null
  try {
    await input.key('ArrowDown')
    let menu = await waitMenu(page, a.key, 1200)
    let choice = a.value ?? (a.want ? chooseOption(menu.options, a.want) : null)
    if (!choice || !menu.options.includes(choice)) {
      // Long or remote lists (schools, cities) only show matches after typing.
      const search = a.value ?? a.search
      if (!search) return null
      // Focus may have moved while waiting; never type into anything else.
      if (!(await page.call<boolean>('focus', a.key))) return null
      await input.type(search)
      menu = await waitMenu(page, a.key, 7000, 400)
      choice = a.value && menu.options.includes(a.value) ? a.value : a.want ? chooseOption(menu.options, a.want) : null
    }
    if (!choice) return null
    if (!(await page.call<boolean>('pick', a.key, choice))) return null
    await sleep(200)
    const shown = await page.call<string>('valueOf', a.key)
    return shown ? choice : null
  } finally {
    const m = await page.call<Menu>('menu', a.key).catch(() => null)
    if (m?.open) await input.key('Escape').catch(() => {})
    await page.call('blur', a.key).catch(() => {})
  }
}

async function attachResume(page: Page, input: Input, path: string, fileName: string): Promise<boolean> {
  const selector = await page.call<string | null>('resumeTarget')
  if (!selector) return false
  try {
    const { root } = await input.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 })
    const { nodeId } = await input.send<{ nodeId: number }>('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) return false
    await input.send('DOM.setFileInputFiles', { files: [path], nodeId })
  } catch {
    return false
  }
  for (let i = 0; i < 12; i++) {
    await sleep(250)
    if (await page.call<boolean>('resumeAttached', fileName).catch(() => false)) return true
  }
  return false
}
