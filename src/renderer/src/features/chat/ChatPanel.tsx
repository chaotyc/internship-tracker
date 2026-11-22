import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { describeAction, visibleReply, type ChatAction, type ChatActionState, type ChatMessage } from '@shared/chat'
import { STAGES, type Role } from '@shared/roles'
import { Icon, type IconName } from '@renderer/components/Icon'
import { api, useRoles } from '@renderer/lib/api'
import type { SettingsTab } from '@renderer/features/settings/SettingsDialog'
import { renderMarkdown } from './markdown'
import { useScrollFade } from './useScrollFade'
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
/** The role the most recent user message was about (what a retry must reuse). */
const lastUserRoleId = (messages: ChatMessage[] | null) => {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) if (messages![i]!.role === 'user') return messages![i]!.roleId
  return null
}
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
  const [inputFocused, setInputFocused] = useState(false)
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

  // Keep following the bottom when the scroller itself resizes (e.g. the composer hint appears).
  useEffect(() => {
    const el = listRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const autosize = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }
  useLayoutEffect(autosize, [draft])

  /** Sends `text`, or with `retry` re-answers the last stored user message using the role it was about. */
  const run = async (text: string, retry = false) => {
    const roleIdForSend = retry ? lastUserRoleId(messages) : (contextRole?.id ?? null)
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
        roleId: roleIdForSend,
        actions: [],
      }
      setMessages((m) => [...(m ?? []), optimistic])
    }
    try {
      await api.invoke('chat:send', { text, roleId: roleIdForSend, retry })
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

  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const cancelClear = () => {
    setConfirmClear(false)
    requestAnimationFrame(() => moreBtnRef.current?.focus())
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
  const loading = messages === null && !loadError
  const empty = messages !== null && list.length === 0 && !sending
  const shown = visibleReply(stream)
  const fade = useScrollFade(listRef, [messages, stream, sending, error, loadError])

  return (
    <aside className="side-panel chat" aria-label="Assistant">
      <header className="side-head chat-head">
        <h2>Assistant</h2>
        {list.length > 0 && <MoreMenu buttonRef={moreBtnRef} active={confirmClear} onClear={() => setConfirmClear(true)} />}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close assistant" title="Close (⌘J)">
          <Icon name="close" />
        </button>
      </header>

      {confirmClear && (
        <div
          className="chat-confirm"
          role="alertdialog"
          aria-label="Clear conversation"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              cancelClear()
            }
          }}
        >
          <span>Clear this conversation? This can’t be undone.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancelClear} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn btn-sm btn-danger is-armed" onClick={() => void clear()}>
            Clear
          </button>
        </div>
      )}

      <div
        className={`chat-scroll${fade.top ? ' fade-top' : ''}${fade.bottom ? ' fade-bottom' : ''}`}
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {loadError && (
          <InlineError message={`Couldn’t load the conversation: ${loadError}`} onRetry={load} />
        )}
        {loading ? (
          <ChatSkeleton />
        ) : empty ? (
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
        className={`chat-composer${inputFocused && !draft ? ' show-hint' : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <ScopePicker roles={roles} current={contextRole} onChange={setContextId} />
        <div className="chat-input">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
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
        <div className="chat-hint-wrap">
          <p className="chat-hint">
            <span className="kbd">Enter</span> to send · <span className="kbd">Shift</span> <span className="kbd">Enter</span> for a new line
          </p>
        </div>
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

/** Button and status wording for each kind of proposed change. */
function actionVerbs(action: ChatAction): { apply: string; busy: string; done: string } {
  switch (action.kind) {
    case 'update_preferences':
      return { apply: 'Save preferences', busy: 'Saving…', done: 'Preferences saved' }
    case 'add_role':
      return { apply: 'Add to board', busy: 'Adding…', done: 'Added to board' }
    case 'move_role': {
      const to = stageLabel(action.stage)
      return { apply: `Move to ${to}`, busy: 'Moving…', done: `Moved to ${to}` }
    }
    case 'save_answers':
      return { apply: 'Save answers', busy: 'Saving…', done: 'Answers saved' }
    case 'set_next_step':
      return { apply: 'Set next step', busy: 'Saving…', done: 'Next step set' }
  }
}

const ACTION_ICON: Record<ChatAction['kind'], IconName> = {
  add_role: 'plus',
  update_preferences: 'sparkle',
  save_answers: 'file',
  move_role: 'arrowRight',
  set_next_step: 'calendar',
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
  const verbs = actionVerbs(action)

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
            {verbs.done}
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
        <div className="chat-action-actions">
          <button type="button" className="btn btn-primary" onClick={() => void act('chat:applyAction')} disabled={busy}>
            <Icon name="check" />
            {busy ? verbs.busy : verbs.apply}
          </button>
          <button type="button" className="btn" onClick={() => void act('chat:dismissAction')} disabled={busy}>
            Dismiss
          </button>
          <span className="chat-action-hint">Nothing changes until you confirm</span>
        </div>
      )}
    </section>
  )
}

/** Header "⋯" menu. Clear lives here, away from Close; choosing it opens the inline confirm. */
function MoreMenu({ buttonRef, active, onClear }: { buttonRef: RefObject<HTMLButtonElement | null>; active: boolean; onClear: () => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  return (
    <div
      className="chat-more"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn${open || active ? ' is-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${uid}-menu` : undefined}
        aria-label="More options"
        title="More options"
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="chat-more-menu" role="menu" id={`${uid}-menu`} aria-label="Conversation">
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setOpen(false)
              onClear()
            }}
          >
            <Icon name="trash" />
            Clear conversation…
          </button>
        </div>
      )}
    </div>
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

function ChatSkeleton() {
  return (
    <div className="chat-skeleton" role="status" aria-live="polite">
      <span className="visually-hidden">Loading conversation…</span>
      <div className="chat-skel-user" aria-hidden="true">
        <span style={{ width: '62%' }} />
      </div>
      <div className="chat-skel-assistant" aria-hidden="true">
        <span style={{ width: '92%' }} />
        <span style={{ width: '84%' }} />
        <span style={{ width: '58%' }} />
      </div>
      <div className="chat-skel-user" aria-hidden="true">
        <span style={{ width: '48%' }} />
      </div>
      <div className="chat-skel-assistant" aria-hidden="true">
        <span style={{ width: '88%' }} />
        <span style={{ width: '70%' }} />
      </div>
    </div>
  )
}

/**
 * Composer control for which role the next message is about. It steers only what is
 * sent next; earlier messages keep the role they were sent with. Shows
 * "Context: All roles" when nothing is attached, or the role as a removable chip.
 */
function ScopePicker({ roles, current, onChange }: { roles: Role[] | null; current: Role | null; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const uid = useId()
  const listId = `${uid}-roles`

  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (roles ?? []).filter((r) => !q || `${r.company} ${r.title}`.toLowerCase().includes(q))
    const items: { id: string | null; role: Role | null }[] = matches.map((r) => ({ id: r.id, role: r }))
    // "All roles" detaches the current one; offer it only when something is attached.
    if (current && !q) items.unshift({ id: null, role: null })
    return items
  }, [roles, query, current])

  const show = () => {
    setQuery('')
    setActive(0)
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }
  const pick = (id: string | null) => {
    onChange(id)
    close(false)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = options[active]
      if (o) pick(o.id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  return (
    <div className="chat-context" ref={rootRef}>
      <span className="chat-context-label" aria-hidden="true">
        Context:
      </span>
      {current ? (
        <span className="chip chat-context-chip" title={`Next message is about ${roleLabel(current)}`}>
          <button
            ref={triggerRef}
            type="button"
            className="chat-context-text"
            onClick={() => (open ? close(false) : show())}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Context for the next message: ${roleLabel(current)}. Change role`}
          >
            {roleLabel(current)}
          </button>
          <button type="button" className="chat-context-remove" onClick={() => onChange(null)} aria-label="Remove role from next message">
            <Icon name="close" />
          </button>
        </span>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="chat-context-trigger"
          onClick={() => (open ? close(false) : show())}
          aria-haspopup="listbox"
          aria-expanded={open}
          title="Ask about a specific role"
          aria-label="Context for the next message: all roles. Change role"
        >
          All roles
          <Icon name="chevronDown" />
        </button>
      )}
      {open && (
        <div className="chat-picker">
          <div className="chat-picker-search">
            <Icon name="search" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search your board"
              role="combobox"
              aria-label="Search roles"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={options[active] ? `${uid}-opt-${active}` : undefined}
            />
          </div>
          <ul className="chat-picker-list" id={listId} role="listbox" aria-label="Roles" ref={listRef}>
            {roles === null && <li className="chat-picker-note">Loading roles…</li>}
            {roles !== null && options.length === 0 && (
              <li className="chat-picker-note">{query.trim() ? 'No roles match.' : 'No roles on your board yet.'}</li>
            )}
            {options.map((o, i) => (
              <li
                key={o.id ?? 'all'}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`chat-picker-option${i === active ? ' is-active' : ''}${o.id && o.id === current?.id ? ' is-current' : ''}`}
                onPointerMove={() => setActive(i)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(o.id)}
              >
                {o.role ? (
                  <>
                    <span className="chat-picker-main">
                      <span className="chat-picker-company">{o.role.company}</span>
                      <span className="chat-picker-title">{o.role.title}</span>
                    </span>
                    <span className="chat-picker-stage">{stageLabel(o.role.stage)}</span>
                  </>
                ) : (
                  <span className="chat-picker-main">
                    <span className="chat-picker-company">All roles</span>
                    <span className="chat-picker-title">Not about one role</span>
                  </span>
                )}
                {o.id !== null && o.id === current?.id && <Icon name="check" className="chat-picker-check" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
