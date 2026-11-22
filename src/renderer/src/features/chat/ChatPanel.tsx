import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { describeAction, visibleReply, type ChatAction, type ChatActionState, type ChatMessage } from '@shared/chat'
import { STAGES, type Role } from '@shared/roles'
import { Icon, type IconName } from '@renderer/components/Icon'
import { api, useRoles } from '@renderer/lib/api'
import type { SettingsTab } from '@renderer/features/settings/SettingsDialog'
import { renderMarkdown } from './markdown'
import './chat.css'

const SUGGESTIONS: { label: string; prompt: string; send: boolean }[] = [
  { label: 'Find roles that fit my resume', prompt: 'Find roles that fit my resume.', send: true },
  { label: 'Draft answers for an application', prompt: 'Draft answers for these application questions:\n\n', send: false },
  { label: 'What should I apply to this week?', prompt: 'What should I apply to this week?', send: true },
  { label: 'Update what I’m looking for', prompt: 'Update what I’m looking for: ', send: false },
]

const NO_AI = /no ai connection/i
/** Errors from the ai feature that are fixed in Settings > AI connections. */
const SETTINGS_HINT = /no ai connection|AI connections/i
const roleLabel = (r: Role) => `${r.company} · ${r.title}`
const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label ?? k

interface Props {
  roleId: string | null
  onClose: () => void
  onOpenSettings?: (tab: SettingsTab) => void
}

export function ChatPanel({ roleId, onClose, onOpenSettings }: Props) {
  const { roles } = useRoles()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [stream, setStream] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [hasResume, setHasResume] = useState<boolean | null>(null)
  const [resumeNote, setResumeNote] = useState<string | null>(null)
  const [contextId, setContextId] = useState(roleId)
  const [lastRoleProp, setLastRoleProp] = useState(roleId)
  if (roleId !== lastRoleProp) {
    setLastRoleProp(roleId)
    setContextId(roleId)
  }

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pinned = useRef(true)

  const roleById = useMemo(() => new Map((roles ?? []).map((r) => [r.id, r])), [roles])
  const contextRole = contextId ? (roleById.get(contextId) ?? null) : null

  const load = useCallback(() => {
    api
      .invoke('chat:history')
      .then((m) => {
        setMessages(m)
        setLoadError(null)
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])

  useEffect(() => {
    load()
    const checkResume = () =>
      api
        .invoke('profile:get')
        .then((p) => setHasResume(!!p.resume?.text?.trim()))
        .catch(() => setHasResume(null))
    checkResume()
    const offProfile = api.on('profile:changed', checkResume)
    const offDelta = api.on('chat:delta', ({ text }) => setStream(text))
    return () => {
      offProfile()
      offDelta()
    }
  }, [load])

  useEffect(() => {
    inputRef.current?.focus()
  }, [contextId])

  // Follow the conversation while the reader is at the bottom.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages, stream, sending, error])

  const autosize = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }
  useLayoutEffect(autosize, [draft])

  const run = async (text: string, retry = false) => {
    setError(null)
    setSending(true)
    setStream('')
    pinned.current = true
    if (!retry) {
      const optimistic: ChatMessage = {
        id: `pending-${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
        roleId: contextRole?.id ?? null,
        actions: [],
      }
      setMessages((m) => [...(m ?? []), optimistic])
    }
    try {
      await api.invoke('chat:send', { text, roleId: contextRole?.id ?? null, retry })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
      setStream('')
      load()
    }
  }

  const send = (text = draft) => {
    const body = text.trim()
    if (!body || sending) return
    setDraft('')
    void run(body)
  }

  const stop = () => void api.invoke('chat:stop').catch(() => undefined)

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape' && sending) {
      e.preventDefault()
      stop()
    }
  }

  const pickSuggestion = (s: (typeof SUGGESTIONS)[number]) => {
    if (s.send) return send(s.prompt)
    setDraft(s.prompt)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }

  const clear = async () => {
    setConfirmClear(false)
    try {
      await api.invoke('chat:clear')
      setMessages([])
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
    inputRef.current?.focus()
  }

  const addResume = async () => {
    try {
      const res = await api.invoke('profile:importResume')
      if (!res) return // cancelled
      setHasResume(!!res.profile.resume?.text?.trim())
      setResumeNote(res.warning)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const replace = (m: ChatMessage) => setMessages((cur) => cur?.map((x) => (x.id === m.id ? m : x)) ?? cur)

  const list = messages ?? []
  const empty = messages !== null && list.length === 0 && !sending
  const shown = visibleReply(stream)

  return (
    <aside className="side-panel chat" aria-label="Assistant">
      <header className="side-head chat-head">
        <h2>Assistant</h2>
        <div className="chat-context">
          {contextRole && (
            <span className="chip chat-context-chip" title={`Asking about ${roleLabel(contextRole)}`}>
              <span className="chat-context-text">{roleLabel(contextRole)}</span>
              <button type="button" onClick={() => setContextId(null)} aria-label="Stop asking about this role">
                <Icon name="close" />
              </button>
            </span>
          )}
        </div>
        {list.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)} disabled={confirmClear}>
            Clear
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close assistant" title="Close (⌘J)">
          <Icon name="close" />
        </button>
      </header>

      {confirmClear && (
        <div className="chat-confirm" role="alertdialog" aria-label="Clear conversation">
          <span>Clear this conversation? This can’t be undone.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn btn-sm btn-danger is-armed" onClick={() => void clear()}>
            Clear
          </button>
        </div>
      )}

      <div
        className="chat-scroll"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {loadError && (
          <InlineError message={`Couldn’t load the conversation: ${loadError}`} onRetry={load} />
        )}
        {empty ? (
          <EmptyState hasResume={hasResume} note={resumeNote} onPick={pickSuggestion} onAddResume={() => void addResume()} />
        ) : (
          <div className="chat-log" role="log" aria-live="polite" aria-busy={sending}>
            {list.map((m) =>
              m.role === 'user' ? (
                <UserMessage key={m.id} message={m} about={m.roleId ? roleById.get(m.roleId) : undefined} />
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  roleName={(id) => {
                    const r = roleById.get(id)
                    return r ? roleLabel(r) : null
                  }}
                  onChange={replace}
                />
              ),
            )}
            {sending && (
              <div className="chat-msg chat-assistant is-streaming">
                {shown ? <div className="md">{renderMarkdown(shown)}</div> : <Thinking />}
              </div>
            )}
            {error && !sending && (
              <InlineError
                message={NO_AI.test(error) ? 'Connect an AI provider to use the assistant. Your existing Claude, ChatGPT or Gemini sign-in works.' : error}
                onRetry={() => void run('', true)}
                action={SETTINGS_HINT.test(error) && onOpenSettings ? { label: 'Open AI connections', run: () => onOpenSettings('ai') } : undefined}
              />
            )}
          </div>
        )}
      </div>

      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <div className="chat-input">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={contextRole ? `Ask about ${contextRole.company}…` : 'Ask anything, or paste a job description'}
            aria-label="Message the assistant"
          />
          {sending ? (
            <button type="button" className="chat-send is-stop" onClick={stop} aria-label="Stop" title="Stop (Esc)">
              <Icon name="stop" />
            </button>
          ) : (
            <button type="submit" className="chat-send" disabled={!draft.trim()} aria-label="Send" title="Send (Enter)">
              <Icon name="send" />
            </button>
          )}
        </div>
        <p className="chat-hint">
          <span className="kbd">Enter</span> to send · <span className="kbd">Shift</span> <span className="kbd">Enter</span> for a new line
        </p>
      </form>
    </aside>
  )
}

function EmptyState({
  hasResume,
  note,
  onPick,
  onAddResume,
}: {
  hasResume: boolean | null
  note: string | null
  onPick: (s: (typeof SUGGESTIONS)[number]) => void
  onAddResume: () => void
}) {
  return (
    <div className="chat-empty">
      <span className="chat-empty-mark" aria-hidden="true">
        <Icon name="sparkle" />
      </span>
      <h3>How can I help?</h3>
      <p>I know your resume, preferences and board. I can judge fit, draft answers and plan your week, and I’ll ask before changing anything.</p>
      <div className="chat-suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s.label} type="button" className="chat-suggestion" onClick={() => onPick(s)}>
            {s.label}
            <Icon name="arrowRight" />
          </button>
        ))}
      </div>
      {hasResume === false && (
        <div className="chat-resume">
          <Icon name="file" />
          <span>Answers are much better with your resume.</span>
          <button type="button" className="btn btn-sm" onClick={onAddResume}>
            <Icon name="upload" />
            Add your resume
          </button>
        </div>
      )}
      {note && <p className="chat-resume-note">{note}</p>}
    </div>
  )
}

function UserMessage({ message, about }: { message: ChatMessage; about: Role | undefined }) {
  return (
    <div className="chat-msg chat-user">
      {about && <span className="chat-about">About {roleLabel(about)}</span>}
      <div className="chat-bubble">{message.content}</div>
    </div>
  )
}

function AssistantMessage({
  message,
  roleName,
  onChange,
}: {
  message: ChatMessage
  roleName: (id: string) => string | null
  onChange: (m: ChatMessage) => void
}) {
  return (
    <div className="chat-msg chat-assistant">
      {message.content && <div className="md">{renderMarkdown(message.content)}</div>}
      {message.stopped && <p className="chat-stopped">Stopped</p>}
      {message.actions.map((a, i) => (
        <ActionCard key={i} messageId={message.id} index={i} action={a.action} state={a.state} roleName={roleName} onChange={onChange} />
      ))}
    </div>
  )
}

const ACTION_ICON: Record<ChatAction['kind'], IconName> = {
  add_role: 'plus',
  update_preferences: 'sparkle',
  save_answers: 'file',
  move_role: 'arrowRight',
}

function ActionCard({
  messageId,
  index,
  action,
  state,
  roleName,
  onChange,
}: {
  messageId: string
  index: number
  action: ChatAction
  state: ChatActionState
  roleName: (id: string) => string | null
  onChange: (m: ChatMessage) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const summary = describeAction(action, { roleName, stageLabel })

  const act = async (channel: 'chat:applyAction' | 'chat:dismissAction') => {
    setBusy(true)
    setErr(null)
    try {
      onChange(await api.invoke(channel, { messageId, index }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`chat-action is-${state}`} aria-label={summary.title}>
      <header>
        <span className="chat-action-icon">
          <Icon name={ACTION_ICON[action.kind]} />
        </span>
        <h4>{summary.title}</h4>
        {state === 'applied' && (
          <span className="chip ok">
            <Icon name="check" />
            Applied
          </span>
        )}
        {state === 'dismissed' && <span className="chip">Dismissed</span>}
      </header>
      {summary.rows.length > 0 && (
        <dl className={action.kind === 'save_answers' ? 'is-stacked' : undefined}>
          {summary.rows.map((r, i) => (
            <div key={i}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {err && <p className="chat-action-error">{err}</p>}
      {state === 'proposed' && (
        <footer>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void act('chat:applyAction')} disabled={busy}>
            <Icon name="check" />
            {busy ? 'Applying…' : 'Apply'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act('chat:dismissAction')} disabled={busy}>
            Dismiss
          </button>
        </footer>
      )}
    </section>
  )
}

function Thinking() {
  return (
    <div className="chat-thinking" aria-label="The assistant is thinking">
      <span />
      <span />
      <span />
    </div>
  )
}

function InlineError({ message, onRetry, action }: { message: string; onRetry: () => void; action?: { label: string; run: () => void } }) {
  return (
    <div className="chat-error" role="alert">
      <Icon name="alert" />
      <p>{message}</p>
      <div className="chat-error-actions">
        {action && (
          <button type="button" className="btn btn-sm btn-primary" onClick={action.run}>
            {action.label}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          <Icon name="refresh" />
          Retry
        </button>
      </div>
    </div>
  )
}
