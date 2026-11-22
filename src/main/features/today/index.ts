import { Notification } from 'electron'
import { CHECK_INTERVAL_MS, localIso, todayItems, type EmailSettings, type EmailStatus } from '@shared/today'
import type { Feature, FeatureContext } from '../../context'
import { isHeadless } from '../../headless'
import { emit, handle } from '../../ipc'
import { seedTodayDemo } from './demo'
import { checkInbox, friendlyImapError, imapflowClient, type ImapConfig, type MailClient } from './imap'
import { ProposalStore, applyProposal, dismissProposal, ingestEmail, ingestRaw, todayMigrations, type HookDeps } from './proposals'
import { reminderDue, reminderText } from './reminder'

const PASSWORD_KEY = 'today.imap.password'
const ACCOUNT_KEY = 'today.email'
const SETTINGS_KEY = 'today.settings'
const REMINDER_KEY = 'today.lastReminder'
/** First check after launch waits a little so startup stays quick. */
const LAUNCH_DELAY_MS = 20_000
/** How far back the very first check looks. */
const FIRST_CHECK_DAYS = 14

interface Account {
  host: string
  port: number
  user: string
  lastCheck: string
  lastResult: string
  lastError: string
  uidValidity: string
  lastUid: number
}

const NO_ACCOUNT: Account = { host: '', port: 993, user: '', lastCheck: '', lastResult: '', lastError: '', uidValidity: '', lastUid: 0 }
const DEFAULT_SETTINGS: EmailSettings = { autoCheck: true, dailyReminder: false }

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

function register(ctx: FeatureContext): void {
  const proposals = new ProposalStore(ctx.store)
  const changed = () => emit('today:changed', {})
  const deps = (): HookDeps => ({ proposals, roles: ctx.services.roles, ai: ctx.services.ai, changed })
  const account = (): Account => ({ ...NO_ACCOUNT, ...ctx.settings.get<Partial<Account>>(ACCOUNT_KEY, {}) })
  const saveAccount = (patch: Partial<Account>) => ctx.settings.set(ACCOUNT_KEY, { ...account(), ...patch })
  const settings = (): EmailSettings => ({ ...DEFAULT_SETTINGS, ...ctx.settings.get<Partial<EmailSettings>>(SETTINGS_KEY, {}) })
  const connected = () => !!account().user && ctx.secrets.has(PASSWORD_KEY)
  let checking = false
  let lastManual = 0

  const status = (): EmailStatus => {
    const a = account()
    return {
      connected: connected(),
      host: a.host,
      port: a.port,
      user: a.user,
      lastCheck: a.lastCheck,
      lastResult: a.lastResult,
      lastError: a.lastError,
      checking,
      canStoreSecrets: ctx.secrets.available,
      settings: settings(),
    }
  }

  const items = () => todayItems(ctx.services.roles.list(), localIso())

  /* ------------------------------- list and proposals ------------------------------- */

  handle('today:list', () => items())
  handle('today:proposals', () => {
    proposals.prune(new Set(ctx.services.roles.list().map((r) => r.id)))
    return proposals.pending()
  })
  handle('today:ingest', ({ raw, roleId }) => ingestRaw(String(raw ?? '').slice(0, 2_000_000), deps(), roleId || undefined))
  handle('today:applyProposal', ({ id, stage, nextStep }) => applyProposal(id, deps(), { stage, nextStep }))
  handle('today:dismissProposal', ({ id }) => dismissProposal(id, deps()))

  /* ------------------------------------ inbox ------------------------------------ */

  const config = (): ImapConfig | null => {
    const a = account()
    const password = ctx.secrets.get(PASSWORD_KEY)
    return a.user && password ? { host: a.host, port: a.port, user: a.user, password } : null
  }

  const runCheck = async (makeClient: (c: ImapConfig) => Promise<MailClient> = imapflowClient): Promise<void> => {
    const cfg = config()
    if (!cfg || checking) return
    checking = true
    changed()
    const a = account()
    const since = a.lastCheck ? new Date(Date.parse(a.lastCheck) - 86_400_000) : new Date(Date.now() - FIRST_CHECK_DAYS * 86_400_000)
    let added = 0
    try {
      const res = await checkInbox(await makeClient(cfg), ctx.services.roles.list(), { uidValidity: a.uidValidity, lastUid: a.lastUid, since }, async (email, role) => {
        const out = await ingestEmail(email, deps(), { origin: 'inbox', roleId: role.id })
        if (out.kind === 'proposal') added++
      })
      const parts = [`Looked at ${res.scanned} new email${res.scanned === 1 ? '' : 's'}`]
      parts.push(res.matched ? `${res.matched} matched a role on your board` : 'none matched a role on your board')
      if (added) parts.push(`${added} new update${added === 1 ? '' : 's'} to review`)
      saveAccount({ lastCheck: new Date().toISOString(), lastResult: parts.join('; ') + '.', lastError: '', uidValidity: res.uidValidity, lastUid: res.lastUid })
    } catch (err) {
      saveAccount({ lastCheck: new Date().toISOString(), lastError: friendlyImapError(err) })
    } finally {
      checking = false
      changed()
    }
  }

  let timer: NodeJS.Timeout | null = null
  /** Next automatic check: on launch, then every 30 minutes, never sooner than 30 minutes after the last one. */
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!connected() || !settings().autoCheck) return
    const last = Date.parse(account().lastCheck) || 0
    const wait = Math.max(LAUNCH_DELAY_MS, last + CHECK_INTERVAL_MS - Date.now())
    timer = setTimeout(() => {
      void runCheck().finally(schedule)
    }, wait)
  }

  handle('today:emailStatus', () => status())

  handle('today:connect', async ({ host, port, user, password }) => {
    const cfg: ImapConfig = { host: String(host ?? '').trim().toLowerCase(), port: Number(port) || 993, user: String(user ?? '').trim(), password: String(password ?? '') }
    if (!HOST.test(cfg.host)) throw new Error('Enter the mail server, for example imap.gmail.com.')
    if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error('Enter a port number (usually 993).')
    if (!cfg.user) throw new Error('Enter your email address.')
    if (!cfg.password.trim()) throw new Error('Paste an app password.')
    if (!ctx.secrets.available) throw new Error('This computer has no keychain available, so the password cannot be stored safely.')
    const client = await imapflowClient({ ...cfg, password: cfg.password.replace(/\s+/g, '') })
    try {
      await client.connect()
      await client.openInboxReadOnly()
    } catch (err) {
      throw new Error(friendlyImapError(err))
    } finally {
      await client.close().catch(() => {})
    }
    ctx.secrets.set(PASSWORD_KEY, cfg.password.replace(/\s+/g, ''))
    ctx.settings.set(ACCOUNT_KEY, { ...NO_ACCOUNT, host: cfg.host, port: cfg.port, user: cfg.user })
    // First look right away, then on the usual schedule.
    void runCheck().finally(schedule)
    return status()
  })

  handle('today:disconnect', () => {
    if (timer) clearTimeout(timer)
    timer = null
    ctx.secrets.delete(PASSWORD_KEY)
    ctx.settings.set(ACCOUNT_KEY, NO_ACCOUNT)
    changed()
    return status()
  })

  handle('today:checkNow', async () => {
    if (!connected()) throw new Error('Connect an inbox first.')
    // A manual check is the user's call, but not twice a minute.
    if (Date.now() - lastManual < 60_000 || checking) return status()
    lastManual = Date.now()
    await runCheck()
    schedule()
    return status()
  })

  handle('today:saveSettings', (patch) => {
    const next: EmailSettings = { ...settings() }
    if (typeof patch.autoCheck === 'boolean') next.autoCheck = patch.autoCheck
    if (typeof patch.dailyReminder === 'boolean') next.dailyReminder = patch.dailyReminder
    ctx.settings.set(SETTINGS_KEY, next)
    schedule()
    void remind()
    changed()
    return status()
  })

  /* ---------------------------------- reminder ---------------------------------- */

  const remind = async () => {
    const today = localIso()
    if (!reminderDue(settings().dailyReminder, ctx.settings.get(REMINDER_KEY, ''), today, new Date())) return
    const text = reminderText(items(), today)
    if (!text) return
    // Never pop real notifications from screenshot runs or automated checks.
    if (isHeadless() || !Notification.isSupported()) return
    ctx.settings.set(REMINDER_KEY, today)
    const n = new Notification({ title: text.title, body: text.body, silent: false })
    n.on('click', () => {
      const w = ctx.mainWindow()
      if (w && !w.isDestroyed()) {
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
        emit('today:show', {})
      }
    })
    n.show()
  }
  setTimeout(() => void remind(), 30_000)
  setInterval(() => void remind(), CHECK_INTERVAL_MS)

  /* ------------------------------------ boot ------------------------------------ */

  schedule()

  if (process.env['TRACKER_DEMO'] === '1') {
    // The demo board is seeded right after features register; wait for it.
    let tries = 0
    const seed = () => {
      if (seedTodayDemo(ctx.services.roles, proposals) || ++tries > 40) return
      setTimeout(seed, 25)
    }
    setImmediate(seed)
  }
}

export const todayFeature: Feature = {
  name: 'today',
  migrations: todayMigrations,
  register,
}
