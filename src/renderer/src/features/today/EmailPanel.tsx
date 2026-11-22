import { useCallback, useEffect, useState } from 'react'
import type { EmailSettings, EmailStatus } from '@shared/today'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { api, useRoles } from '@renderer/lib/api'
import { EmailDrop } from './EmailDrop'
import { MailIcon, ShieldIcon, Switch, sinceLabel } from './parts'
import './today.css'

const PRESETS = [
  { label: 'Gmail', host: 'imap.gmail.com' },
  { label: 'Outlook', host: 'outlook.office365.com' },
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

  if (loadError) return <p className="settings-empty">Couldn't load email settings: {loadError}</p>
  if (!status) return null

  return (
    <>
      <section className="settings-section">
        <h3>Inbox</h3>
        <p>Connect your inbox and recruiter emails become proposed updates in Today. You review each one; nothing changes until you apply it.</p>
        {status.connected ? <Connected status={status} onStatus={setStatus} onSettings={saveSettings} /> : <ConnectForm onConnected={setStatus} canStore={status.canStoreSecrets} />}
      </section>

      <section className="settings-section">
        <h3>Paste or drop an email</h3>
        <p>No inbox connection needed: paste a message’s text, or drop a .eml file saved from your mail app.</p>
        <EmailDrop roles={roles ?? []} where="settings" />
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
        <span className={`ep-status-icon${error ? ' is-error' : ''}`}>{error ? <Icon name="alert" /> : <MailIcon />}</span>
        <div>
          <strong>{status.user}</strong>
          <small>
            {status.host}:{status.port} · read-only
          </small>
          {checking ? (
            <small>Checking for new emails…</small>
          ) : error ? (
            <small className="is-error">
              Last check {sinceLabel(status.lastCheck)}: {error}
            </small>
          ) : status.lastCheck ? (
            <small>
              Checked {sinceLabel(status.lastCheck)}. {status.lastResult}
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
      <PrivacyNote />
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
      <div className="ep-presets" role="group" aria-label="Mail provider">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="ns-chip" aria-pressed={host === p.host} onClick={() => setHost(p.host)}>
            {p.label}
          </button>
        ))}
      </div>
      <form
        className="ep-form"
        onSubmit={(e) => {
          e.preventDefault()
          void connect()
        }}
      >
        <label className="field">
          <span>Mail server (IMAP)</span>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.gmail.com" spellCheck={false} autoCapitalize="off" />
        </label>
        <label className="field">
          <span>Port</span>
          <input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="993" />
        </label>
        <label className="field wide">
          <span>Email address</span>
          <input type="email" value={user} onChange={(e) => setUser(e.target.value)} placeholder="you@example.com" autoComplete="off" spellCheck={false} />
        </label>
        <label className="field wide">
          <span>App password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="16-character app password" autoComplete="off" />
          <small className="hint">Not your normal password. Stored only in this computer’s keychain.</small>
        </label>
        <details className="ep-help wide">
          <summary>How do I get an app password?</summary>
          <ol>
            <li>
              <strong>Gmail:</strong> turn on 2-Step Verification for your Google Account, then create an app password at <code>myaccount.google.com/apppasswords</code>. Server{' '}
              <code>imap.gmail.com</code>, port <code>993</code>.
            </li>
            <li>
              <strong>Outlook.com:</strong> turn on two-step verification at <code>account.microsoft.com/security</code>, then under Advanced security options create an app password. Server{' '}
              <code>outlook.office365.com</code>, port <code>993</code>. School and work accounts often block app passwords; ask your IT team.
            </li>
            <li>
              <strong>iCloud:</strong> create an app-specific password at <code>account.apple.com</code> under Sign-In and Security. Server <code>imap.mail.me.com</code>, port <code>993</code>.
            </li>
          </ol>
        </details>
        <div className="ep-form-foot">
          <button type="submit" className="btn btn-primary" disabled={busy || !canStore || !host.trim() || !user.trim() || !password.trim()}>
            {busy ? <Icon name="refresh" className="td-spin" /> : <Icon name="lock" />}
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
      <PrivacyNote />
    </>
  )
}

function PrivacyNote() {
  return (
    <p className="td-privacy">
      <ShieldIcon />
      Read-only over TLS: the app never marks, moves, deletes or sends mail. It looks at the sender and subject of new emails on this computer and opens only the ones from companies on your board. Only those go to your AI provider.
    </p>
  )
}
