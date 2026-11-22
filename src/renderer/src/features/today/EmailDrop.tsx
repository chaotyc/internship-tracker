import { useEffect, useRef, useState } from 'react'
import type { Role } from '@shared/roles'
import { Icon } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import { ShieldIcon, readEmailFile } from './parts'

type Msg = { tone: '' | 'ok' | 'error'; text: string }

/**
 * Paste an email's text or drop a .eml file. The email is read and matched on this
 * computer; only a match goes on to the AI. Unmatched emails can be pinned to a role.
 */
export function EmailDrop({
  roles,
  incoming,
  where = 'today',
  autoFocus,
}: {
  roles: Role[]
  /** Text dropped elsewhere (the whole Today view) to read now. */
  incoming?: { raw: string; n: number } | null
  where?: 'today' | 'settings'
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>({ tone: '', text: '' })
  const [over, setOver] = useState(false)
  const [unmatched, setUnmatched] = useState<{ raw: string; from: string; subject: string } | null>(null)
  const [pick, setPick] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async (raw: string, roleId?: string) => {
    if (!raw.trim() || busy) return
    setBusy(true)
    setMsg({ tone: '', text: '' })
    try {
      const res = await api.invoke('today:ingest', roleId ? { raw, roleId } : { raw })
      setUnmatched(null)
      if (res.kind === 'unmatched') {
        setUnmatched({ raw, from: res.from, subject: res.subject })
        return
      }
      setText('')
      if (res.kind === 'proposal')
        setMsg({ tone: 'ok', text: `Proposed an update for ${res.proposal.company}. ${where === 'today' ? 'Review it above.' : 'Review it in Today.'}` })
      else if (res.kind === 'duplicate')
        setMsg({ tone: '', text: res.proposal.status === 'pending' ? `That email is already waiting for review (${res.proposal.company}).` : `That email was already ${res.proposal.status} (${res.proposal.company}).` })
      else setMsg({ tone: '', text: res.summary })
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (incoming?.raw) void submit(incoming.raw)
    // Only when a new drop arrives.
  }, [incoming?.n])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      await submit(await readEmailFile(file))
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message })
    }
  }

  const open = roles.filter((r) => r.stage !== 'closed').sort((a, b) => a.company.localeCompare(b.company))

  return (
    <div
      className={`td-drop${over ? ' is-over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        void onFile(e.dataTransfer.files[0])
      }}
    >
      <textarea
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit(text)
          }
        }}
        placeholder="Paste a recruiter email here: sender, subject and message"
        aria-label="Email text"
        spellCheck={false}
      />
      <div className="td-drop-foot">
        <span>
          or drop a .eml file ·{' '}
          <button type="button" className="td-link" onClick={() => fileRef.current?.click()}>
            choose a file
          </button>
        </span>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => void submit(text)}>
          {busy ? <Icon name="refresh" className="td-spin" /> : <Icon name="sparkle" />}
          {busy ? 'Reading…' : 'Read email'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".eml,message/rfc822,.txt"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {busy && <p className="td-drop-msg">Matching it to your board{roles.length ? ', then working out what changed…' : '…'}</p>}
      {msg.text && !busy && <p className={`td-drop-msg${msg.tone ? ` is-${msg.tone}` : ''}`} role={msg.tone === 'error' ? 'alert' : undefined}>{msg.text}</p>}
      {unmatched && !busy && (
        <div className="td-pick">
          <p>
            Couldn’t match {unmatched.subject ? <strong>“{unmatched.subject}”</strong> : 'this email'} to a role on your board, so it wasn’t sent anywhere. Which role is it about?
          </p>
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Role this email is about">
            <option value="">Choose a role…</option>
            {open.map((r) => (
              <option key={r.id} value={r.id}>
                {r.company} · {r.title}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm" disabled={!pick} onClick={() => void submit(unmatched.raw, pick)}>
            Use this role
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setUnmatched(null)}>
            Never mind
          </button>
        </div>
      )}
      {/* Settings keeps privacy claims in Data & privacy. */}
      {where === 'today' && (
        <p className="td-privacy">
          <ShieldIcon />
          Read on this computer. Only an email that matches a role on your board goes to your AI provider, and only that email.
        </p>
      )}
    </div>
  )
}
