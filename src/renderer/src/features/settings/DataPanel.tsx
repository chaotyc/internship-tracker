import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import type { ProfileStatus } from '@shared/profile'
import { PaneHeader } from './PaneHeader'
import './data.css'

function fileManager(platform: string | undefined): string {
  if (platform === 'darwin') return 'Finder'
  if (platform === 'win32') return 'File Explorer'
  return 'file manager'
}

function keychainName(platform: string | undefined): string {
  if (platform === 'darwin') return 'macOS Keychain'
  if (platform === 'win32') return 'Windows credential store'
  return 'system keyring'
}

/** Splits a path so the end (separator + last folder) stays visible while the start truncates. */
function splitPath(path: string): [string, string] {
  const trimmed = path.replace(/[\\/]+$/, '')
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return i <= 0 ? ['', trimmed] : [trimmed.slice(0, i), trimmed.slice(i)]
}

type Msg = { tone: 'ok' | 'error'; text: string } | null

export function DataPanel() {
  const [status, setStatus] = useState<ProfileStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<Msg>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const confirmId = useId()
  const confirmRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .invoke('profile:status')
      .then(setStatus)
      .catch((e: Error) => setStatusError(e.message))
  }, [])

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  const reveal = () => {
    setRevealError(null)
    api.invoke('profile:revealData').catch((e: Error) => setRevealError(e.message))
  }

  const exportAll = async () => {
    setExporting(true)
    setExportMsg(null)
    try {
      const res = await api.invoke('profile:exportAll')
      if (res) setExportMsg({ tone: 'ok', text: `Saved to ${res.path}` })
    } catch (e) {
      setExportMsg({ tone: 'error', text: (e as Error).message })
    } finally {
      setExporting(false)
    }
  }

  const deleteAll = async () => {
    if (typed !== 'DELETE') return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.invoke('profile:deleteAll')
      // Start fresh: every panel and the board reload from the now-empty store.
      location.reload()
    } catch (e) {
      setDeleteError((e as Error).message)
      setDeleting(false)
    }
  }

  const cancelDelete = () => {
    setConfirming(false)
    setTyped('')
    setDeleteError(null)
  }

  const platform = status?.platform
  const encrypted = status?.encrypted

  return (
    <div className="dp">
      <PaneHeader title="Data & privacy" description="No account, no cloud copy. Export or erase it any time." />
      <section className="settings-section" aria-labelledby="dp-where">
        <h3 id="dp-where">Where your data lives</h3>
        <p>This folder holds your board, profile, chats and resumes.</p>
        {statusError ? (
          <p className="dp-msg is-error">
            <Icon name="alert" />
            {statusError}
          </p>
        ) : (
          <div className="dp-path">
            <span className="dp-path-icon" aria-hidden="true">
              <Icon name="folder" />
            </span>
            <div className="dp-path-text">
              {status ? (
                <code className="dp-path-name" title={status.dataDir}>
                  <span className="dp-path-start">{splitPath(status.dataDir)[0]}</span>
                  <span className="dp-path-end">{splitPath(status.dataDir)[1]}</span>
                </code>
              ) : (
                <code className="dp-path-name">…</code>
              )}
              <small>tracker.sqlite holds your board and profile; resumes/ holds the copy of your resume.</small>
            </div>
            <button type="button" className="btn btn-sm" onClick={reveal} disabled={!status}>
              Show in {fileManager(platform)}
            </button>
          </div>
        )}
        {status?.demo && (
          <div className="dp-demo" role="status">
            <Icon name="alert" />
            <span>
              <strong>Demo mode.</strong> This session uses a temporary database, so nothing you do here is written to this folder.
            </span>
          </div>
        )}
        {revealError && (
          <p className="dp-msg is-error">
            <Icon name="alert" />
            {revealError}
          </p>
        )}
      </section>

      <section className="settings-section" aria-labelledby="dp-enc">
        <h3 id="dp-enc">Encryption</h3>
        {status && (
          <div className={`dp-status ${encrypted ? 'is-ok' : 'is-warn'}`}>
            <span className="dp-status-icon" aria-hidden="true">
              {encrypted ? <Icon name="lock" /> : <Icon name="alert" />}
            </span>
            <div>
              <strong>{encrypted ? `Protected by your ${keychainName(platform)}` : 'Keychain encryption is off'}</strong>
              <p>
                {encrypted
                  ? 'Your profile, saved answers, demographics and API keys are encrypted with a key only your user account can unlock before anything is written to disk.'
                  : `The ${keychainName(platform)} isn’t available, so the app can’t encrypt. Your board and the basic profile are stored unencrypted in the folder above; saved answers, demographics and API keys aren’t stored at all until it is.`}
              </p>
            </div>
          </div>
        )}
        <ul className="dp-facts">
          <li>
            <Icon name="check" />
            <span>
              AI features (the assistant, Fill in from link, Find roles ranking and email matching) send the profile and resume excerpts they need, plus the posting text, to the AI
              provider you connected. Nothing goes to any other provider.
            </span>
          </li>
          <li>
            <Icon name="check" />
            <span>Find roles and Recheck postings read public job-board pages. No analytics, no tracking.</span>
          </li>
          <li>
            <Icon name="check" />
            <span>If you connect email, the app signs in to your mailbox read-only to fetch recent mail and matches it to your board on this computer first.</span>
          </li>
        </ul>
      </section>

      <section className="settings-section" aria-labelledby="dp-export">
        <h3 id="dp-export">Export data</h3>
        <p>One JSON file with your roles, profile, saved answers, settings and chats. API keys are never included.</p>
        <div className="dp-row">
          <button type="button" className="btn" onClick={() => void exportAll()} disabled={exporting}>
            <Icon name="download" />
            {exporting ? 'Exporting…' : 'Export data…'}
          </button>
          {exportMsg && (
            <span className={`dp-msg ${exportMsg.tone === 'ok' ? 'is-ok' : 'is-error'}`} role="status">
              <Icon name={exportMsg.tone === 'ok' ? 'check' : 'alert'} />
              <span className="dp-msg-text">{exportMsg.text}</span>
            </span>
          )}
        </div>
        <p className="dp-small">The file isn’t encrypted. Keep it somewhere private, and delete it when you no longer need it.</p>
      </section>

      <section className="settings-section dp-danger" aria-labelledby="dp-delete">
        <h3 id="dp-delete">Delete everything</h3>
        <p>Erase every role, your profile, saved answers, chats, settings, API keys and the stored resume from this computer. You can’t undo this.</p>
        {!confirming ? (
          <div className="dp-row">
            <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
              <Icon name="trash" />
              Delete everything…
            </button>
            <span className="dp-small">Want a copy first? Export above.</span>
          </div>
        ) : (
          <div className="dp-confirm" role="group" aria-labelledby={`${confirmId}-t`}>
            <strong id={`${confirmId}-t`}>This permanently erases:</strong>
            <ul>
              <li>Every role on your board, with notes and dates</li>
              <li>Your profile, resume copy, saved answers and demographics</li>
              <li>Chats, suggestions, job-board settings and AI connections</li>
            </ul>
            <div className="field">
              <label htmlFor={confirmId}>
                Type <b>DELETE</b> to confirm
              </label>
              <input
                ref={confirmRef}
                id={confirmId}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void deleteAll()
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    e.preventDefault()
                    cancelDelete()
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
                placeholder="DELETE"
              />
            </div>
            {deleteError && (
              <p className="dp-msg is-error">
                <Icon name="alert" />
                {deleteError}
              </p>
            )}
            <div className="dp-row">
              <button type="button" className="btn btn-danger is-armed" onClick={() => void deleteAll()} disabled={typed !== 'DELETE' || deleting}>
                <Icon name="trash" />
                {deleting ? 'Deleting…' : 'Delete everything'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={cancelDelete} disabled={deleting}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
