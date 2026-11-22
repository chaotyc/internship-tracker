import { useCallback, useEffect, useId, useState, type KeyboardEvent } from 'react'
import type { EmailSettings, EmailStatus } from '@shared/today'
import { Icon } from '@renderer/components/Icon'
import { Switch } from '@renderer/components/Switch'
import { useToast } from '@renderer/components/Toast'
import { api, useRoles } from '@renderer/lib/api'
import { since } from '@renderer/lib/format'
import { PaneHeader } from '@renderer/features/settings/PaneHeader'
import { EmailDrop } from './EmailDrop'
import '@renderer/features/settings/profile.css'
import './today.css'

// No Outlook.com: Microsoft stopped accepting passwords and app passwords over IMAP (OAuth only) in Sept 2024.
// A server that isn't a preset's (including an old Outlook one) shows as Other.
const PRESETS = [
  { label: 'Gmail', host: 'imap.gmail.com' },
  { label: 'iCloud', host: 'imap.mail.me.com' },
  { label: 'Fastmail', host: 'imap.fastmail.com' },
]

/** Settings > Email updates: connect an inbox (read-only), paste or drop emails, daily reminder. */
export function EmailPanel() {
  const toast = useToast()
  const { roles } = useRoles()
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(() => {
    api
      .invoke('today:emailStatus')
      .then((s) => {
        setStatus(s)
        setLoadError('')
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])
  useEffect(() => {
    load()
    return api.on('today:changed', load)
  }, [load])

  const saveSettings = async (patch: Partial<EmailSettings>) => {
    if (status) setStatus({ ...status, settings: { ...status.settings, ...patch } })
    try {
      setStatus(await api.invoke('today:saveSettings', patch))
    } catch (e) {
      toast(`Couldn't save: ${(e as Error).message}`, { tone: 'error' })
      load()
    }
  }

  const header = <PaneHeader title="Email updates" description="Proposed updates show up in Today for you to review." />
  if (loadError)
    return (
      <>
        {header}
        <div className="banner error settings-load-error" role="alert">
          <Icon name="alert" />
          Couldn't load email settings: {loadError}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setLoadError('')
              load()
            }}
          >
            Try again
          </button>
        </div>
      </>
    )
  if (!status)
    return (
      <>
        {header}
        <div className="pf-loading" role="status" aria-busy="true">
          <span className="visually-hidden">Loading email settings…</span>
        </div>
      </>
    )

  return (
    <>
      {header}
      <section className="settings-section">
        <h3>Inbox</h3>
        <p>Connect read-only to pick up new recruiter emails automatically.</p>
        {status.connected ? <Connected status={status} onStatus={setStatus} onSettings={saveSettings} /> : <ConnectForm onConnected={setStatus} canStore={status.canStoreSecrets} />}
      </section>

      <section className="settings-section">
        <h3>Paste or drop an email</h3>
        <p>No inbox connection needed: paste a message’s text, or drop a .eml file saved from your mail app.</p>
        <div className="ep-drop">
          <EmailDrop roles={roles ?? []} where="settings" />
        </div>
      </section>

      <section className="settings-section">
        <h3>Daily reminder</h3>
        <Switch
          checked={status.settings.dailyReminder}
          onChange={(v) => void saveSettings({ dailyReminder: v })}
          label="Notify me about what’s due"
          hint="One notification a day, after 8 am, when a next step or deadline is due today or overdue."
        />
      </section>
    </>
  )
}

function Connected({ status, onStatus, onSettings }: { status: EmailStatus; onStatus: (s: EmailStatus) => void; onSettings: (p: Partial<EmailSettings>) => void }) {
  const toast = useToast()
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const checking = status.checking || busy
  const error = status.lastError

  const checkNow = async () => {
    setBusy(true)
    try {
      onStatus(await api.invoke('today:checkNow'))
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const disconnect = async () => {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 4000)
      return
    }
    try {
      onStatus(await api.invoke('today:disconnect'))
      toast('Inbox disconnected and the app password deleted.')
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    }
  }

  return (
    <>
      <div className="ep-status">
        <span className={`ep-status-icon${error ? ' is-error' : ''}`}>{error ? <Icon name="alert" /> : <Icon name="mail" />}</span>
        <div>
          <strong>{status.user}</strong>
          <small>
            {status.host}:{status.port} · read-only
          </small>
          {checking ? (
            <small>Checking for new emails…</small>
          ) : error ? (
            <small className="is-error">
              Last check {since(status.lastCheck)}: {error}
            </small>
          ) : status.lastCheck ? (
            <small>
              Checked {since(status.lastCheck)}. {status.lastResult}
            </small>
          ) : (
            <small>Not checked yet.</small>
          )}
        </div>
        <div className="ep-status-actions">
          <button type="button" className="btn btn-sm" onClick={() => void checkNow()} disabled={checking}>
            <Icon name="refresh" className={checking ? 'td-spin' : undefined} />
            {checking ? 'Checking…' : 'Check now'}
          </button>
          <button type="button" className={`btn btn-sm btn-danger${armed ? ' is-armed' : ''}`} onClick={() => void disconnect()}>
            {armed ? 'Click to confirm' : 'Disconnect'}
          </button>
        </div>
      </div>
      <Switch
        checked={status.settings.autoCheck}
        onChange={(v) => onSettings({ autoCheck: v })}
        label="Check automatically"
        hint="When the app opens, then every 30 minutes while it’s running. Never more often."
      />
    </>
  )
}

function ConnectForm({ onConnected, canStore }: { onConnected: (s: EmailStatus) => void; canStore: boolean }) {
  const [host, setHost] = useState('imap.gmail.com')
  const [port, setPort] = useState('993')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [serverOpen, setServerOpen] = useState(false)
  const providerId = useId()
  const found = PRESETS.findIndex((p) => p.host === host)
  // The last option is Other: always the one chosen when the server isn't a preset's.
  const choice = custom || found < 0 ? PRESETS.length : found
  const pick = (i: number) => {
    if (i === PRESETS.length) return setCustom(true)
    setCustom(false)
    setHost(PRESETS[i]!.host)
    setPort('993')
  }
  // Presets know their server, so it stays folded away; Other shows it.
  const showServer = choice === PRESETS.length || serverOpen
  // Arrow keys move the choice, like any radio group.
  const movePreset = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const n = PRESETS.length + 1
    const i = (choice + d + n) % n
    pick(i)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[i]?.focus()
  }

  const connect = async () => {
    setBusy(true)
    setError('')
    try {
      onConnected(await api.invoke('today:connect', { host, port: Number(port), user, password }))
      setPassword('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="field ep-provider">
        <span id={providerId}>Mail provider</span>
        <div className="settings-segmented" role="radiogroup" aria-labelledby={providerId} onKeyDown={movePreset}>
          {[...PRESETS.map((p) => p.label), 'Other'].map((label, i) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={i === choice}
              tabIndex={i === choice ? 0 : -1}
              className={i === choice ? 'is-on' : undefined}
              onClick={() => pick(i)}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Outlook.com no longer accepts app passwords over IMAP. */}
        <small className="hint">Using Outlook? Paste or drop emails instead.</small>
      </div>
      <form
        className="ep-form"
        onSubmit={(e) => {
          e.preventDefault()
          void connect()
        }}
      >
        {choice < PRESETS.length && (
          <div className="ep-server-toggle wide">
            <button type="button" className="settings-disclosure" aria-expanded={serverOpen} aria-controls={`${providerId}-server`} onClick={() => setServerOpen((o) => !o)}>
              <Icon name="chevronDown" />
              Server settings
            </button>
            {!serverOpen && (
              <span className="ep-server-sum">
                {host}:{port || '993'}
              </span>
            )}
          </div>
        )}
        {showServer && (
          <div id={`${providerId}-server`} className="ep-server wide">
            <label className="field">
              <span>Mail server (IMAP)</span>
              <input
                value={host}
                onChange={(e) => {
                  // Editing a preset's server makes it a custom one.
                  if (choice < PRESETS.length) setCustom(true)
                  setHost(e.target.value)
                }}
                placeholder="imap.example.com"
                spellCheck={false}
                autoCapitalize="off"
              />
            </label>
            <label className="field">
              <span>Port</span>
              <input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="993" />
            </label>
          </div>
        )}
        <label className="field wide">
          <span>Email address</span>
          <input type="email" value={user} onChange={(e) => setUser(e.target.value)} placeholder="you@example.com" autoComplete="off" spellCheck={false} />
        </label>
        <label className="field wide">
          <span>App password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="16-character app password" autoComplete="off" />
          <small className="hint">Not your normal password. Stored only in this computer’s keychain.</small>
        </label>
        <div className="ep-help wide">
          <button type="button" className="settings-disclosure" aria-expanded={helpOpen} aria-controls={`${providerId}-help`} onClick={() => setHelpOpen((o) => !o)}>
            <Icon name="chevronDown" />
            How do I get an app password?
          </button>
          {helpOpen && (
            <ol id={`${providerId}-help`}>
              <li>
                <strong>Gmail:</strong> turn on 2-Step Verification for your Google Account, then create an app password at <code>myaccount.google.com/apppasswords</code>. Server{' '}
                <code>imap.gmail.com</code>, port <code>993</code>.
              </li>
              <li>
                <strong>iCloud:</strong> create an app-specific password at <code>account.apple.com</code> under Sign-In and Security. Server <code>imap.mail.me.com</code>, port <code>993</code>.
              </li>
              <li>
                <strong>Fastmail:</strong> go to Settings, then Privacy &amp; Security, then Integrations, and create a new app password with IMAP access. Server{' '}
                <code>imap.fastmail.com</code>, port <code>993</code>.
              </li>
            </ol>
          )}
        </div>
        <div className="ep-form-foot">
          <button type="submit" className="btn btn-primary" disabled={busy || !canStore || !host.trim() || !user.trim() || !password.trim()}>
            {busy ? <Icon name="refresh" className="td-spin" /> : <Icon name="mail" />}
            {busy ? 'Connecting…' : 'Connect read-only'}
          </button>
          {error && (
            <p className="ep-error" role="alert">
              {error}
            </p>
          )}
          {!canStore && <p className="ep-error">This computer has no keychain available, so an app password can’t be stored safely.</p>}
        </div>
      </form>
    </>
  )
}
