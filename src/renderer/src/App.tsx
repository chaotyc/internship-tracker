import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STAGES, type Role, type StageKey } from '@shared/roles'
import { orderAt } from '@shared/order'
import { attentionCount, localIso, todayItems } from '@shared/today'
import { Icon } from './components/Icon'
import { useToast } from './components/Toast'
import { api, useRoles } from './lib/api'
import { plural } from './lib/format'
import { Board, byStage, matchesQuery } from './features/board/Board'
import { RoleDialog } from './features/board/RoleDialog'
import { ChatPanel } from './features/chat/ChatPanel'
import { chatRun } from './features/chat/chatStore'
import { AutosearchButton } from './features/search/AutosearchButton'
import { RefreshButton } from './features/search/RefreshButton'
import { SuggestionsTray } from './features/search/SuggestionsTray'
import { SettingsDialog, type SettingsTab } from './features/settings/SettingsDialog'
import { TodayView } from './features/today/TodayView'
import './app.css'

const MOD = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl+'

export function App() {
  const toast = useToast()
  const { roles, setRoles, error, reload } = useRoles()
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<{ open: boolean; id: string | null; stage: StageKey }>({ open: false, id: null, stage: 'saved' })
  const [chat, setChat] = useState<{ open: boolean }>({ open: false })
  const [settings, setSettings] = useState<{ open: boolean; tab: SettingsTab }>({ open: false, tab: 'profile' })
  const [tray, setTray] = useState(false)
  const [view, setView] = useState<'board' | 'today'>('board')
  const [todayMatches, setTodayMatches] = useState(0)
  const [pendingEmails, setPendingEmails] = useState(0)
  const [day, setDay] = useState(localIso())
  const searchRef = useRef<HTMLInputElement>(null)
  const csvRef = useRef<HTMLInputElement>(null)

  const openRole = useCallback((id: string) => setDialog({ open: true, id, stage: 'saved' }), [])
  const addRole = useCallback((stage: StageKey = 'saved') => setDialog({ open: true, id: null, stage }), [])

  const move = useCallback(
    (id: string, stage: StageKey, index: number) => {
      // Optimistic: place the card now, then let the store confirm.
      setRoles((cur) => {
        if (!cur) return cur
        const others = byStage(cur.filter((r) => r.id !== id))[stage].map((r) => r.order)
        return cur.map((r) => (r.id === id ? { ...r, stage, order: orderAt(others, index) } : r))
      })
      api.invoke('roles:move', { id, stage, index }).catch((e: Error) => {
        toast(`Couldn't move that card: ${e.message}`, { tone: 'error' })
        reload()
      })
    },
    [setRoles, reload, toast],
  )

  const importCsv = async (file: File) => {
    try {
      const res = await api.invoke('roles:importCsv', { csv: await file.text() })
      toast(
        res.added
          ? `Imported ${res.added} role${res.added === 1 ? '' : 's'}${res.skipped ? `, skipped ${res.skipped} already on the board` : ''}.`
          : 'Every role in that file is already on the board.',
      )
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    }
  }

  // Screenshot views: #view=add | settings | settings-ai | settings-boards | chat | role
  useEffect(() => {
    const view = new URLSearchParams(location.hash.slice(1)).get('view')
    if (view === 'add') addRole()
    else if (view?.startsWith('settings')) setSettings({ open: true, tab: (view.split('-')[1] as SettingsTab) ?? 'profile' })
    else if (view === 'chat') setChat({ open: true })
    else if (view === 'today') setView('today')
    else if (view === 'suggestions') setTray(true)
  }, [addRole])
  useEffect(() => {
    const view = new URLSearchParams(location.hash.slice(1)).get('view')
    if (view === 'role' && roles?.length) setDialog((d) => (d.open ? d : { open: true, id: roles.find((r) => r.stage === 'interviewing')?.id ?? roles[0]!.id, stage: 'saved' }))
  }, [roles])

  // Features outside the shell (e.g. autofill inside the role dialog) ask for Settings with an event.
  useEffect(() => {
    const onOpen = (e: Event) => {
      setDialog((d) => ({ ...d, open: false }))
      setSettings({ open: true, tab: ((e as CustomEvent).detail as SettingsTab) ?? 'profile' })
    }
    window.addEventListener('app:open-settings', onOpen)
    const offToday = api.on('today:show', () => setView('today'))
    return () => {
      window.removeEventListener('app:open-settings', onOpen)
      offToday()
    }
  }, [])

  // The Today tab's count: pending email proposals, plus what's overdue or due today. Rolls over at midnight.
  useEffect(() => {
    const loadPending = () =>
      api
        .invoke('today:proposals')
        .then((p) => setPendingEmails(p.length))
        .catch(() => {})
    loadPending()
    const off = api.on('today:changed', loadPending)
    const tick = setInterval(() => setDay(localIso()), 60_000)
    return () => {
      off()
      clearInterval(tick)
    }
  }, [])
  const attention = useMemo(() => attentionCount(todayItems(roles ?? [], day), pendingEmails, day), [roles, pendingEmails, day])

  // Keyboard: / filter, N add, ⌘J assistant, ⌘, settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')
      const modal = document.querySelector('dialog[open]')
      if (modal && (e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'j' || e.key === ',')) {
        e.preventDefault()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setChat((c) => ({ ...c, open: !c.open }))
      } else if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setSettings({ open: true, tab: 'profile' })
      } else if (!typing && !modal && e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (!typing && !modal && e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        addRole()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addRole])

  const counts = useMemo(() => {
    const g = byStage(roles ?? [])
    return STAGES.map((s) => ({ ...s, n: g[s.key].length }))
  }, [roles])
  const active = counts.filter((c) => c.key === 'applied' || c.key === 'interviewing' || c.key === 'offer').reduce((a, c) => a + c.n, 0)
  const boardCount = useMemo(() => (roles ?? []).filter((r) => matchesQuery(r, query)).length, [roles, query])
  // The filter count follows the view on screen.
  const visibleCount = view === 'today' ? todayMatches : boardCount
  const editing: Role | null = dialog.id ? (roles?.find((r) => r.id === dialog.id) ?? null) : null

  return (
    <div className={`app${chat.open ? ' has-panel' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <rect x="2" y="3" width="3.2" height="10" rx="1" />
              <rect x="6.4" y="3" width="3.2" height="7" rx="1" />
              <rect x="10.8" y="3" width="3.2" height="4.5" rx="1" />
            </svg>
          </span>
          <div>
            <h1>Applications</h1>
            <p className="tabular">
              {roles ? `${plural(roles.length, 'role')} · ${active} in progress` : 'Loading…'}
            </p>
          </div>
        </div>
        <div className="view-switch" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'is-on' : ''} onClick={() => setView('board')}>
            <Icon name="board" />
            Board
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'today'}
            className={view === 'today' ? 'is-on' : ''}
            onClick={() => setView('today')}
            title={attention ? `${attention} to look at: email updates, overdue and due today` : undefined}
          >
            <Icon name="sun" />
            Today
            {attention > 0 && (
              <span className="view-count tabular">
                {attention}
                <span className="visually-hidden"> to look at</span>
              </span>
            )}
          </button>
        </div>
        <div className="topbar-actions">
          <RefreshButton />
          <label className="search">
            <Icon name="search" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
              placeholder={view === 'today' ? 'Filter Today' : 'Filter roles'}
              aria-label={view === 'today' ? 'Filter Today' : 'Filter roles'}
            />
            {query ? (
              <>
                <span className="search-count tabular">{visibleCount}</span>
                <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear filter">
                  <Icon name="close" />
                </button>
              </>
            ) : (
              <span className="kbd">/</span>
            )}
          </label>
          <AutosearchButton onResults={() => setTray(true)} />
          <button type="button" className="btn btn-primary" onClick={() => addRole()} title="Add role (N)">
            <Icon name="plus" />
            Add role
          </button>
          <span className="topbar-sep" />
          <button
            type="button"
            className={`icon-btn${chat.open ? ' is-on' : ''}`}
            onClick={() => setChat((c) => ({ ...c, open: !c.open }))}
            aria-label="Assistant"
            aria-pressed={chat.open}
            title={`Assistant (${MOD}J)`}
          >
            <Icon name="chat" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSettings({ open: true, tab: 'profile' })}
            aria-label="Settings"
            title={`Settings (${MOD},)`}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <div className="workspace">
        <main className="main">
          <SuggestionsTray open={tray} onClose={() => setTray(false)} />
          {error && (
            <div className="banner error">
              <Icon name="alert" />
              Couldn't load your roles: {error}
              <button type="button" className="btn btn-sm" onClick={reload}>
                Try again
              </button>
            </div>
          )}
          {view === 'today' ? (
            <TodayView onOpenRole={openRole} onAddRole={() => addRole()} query={query} onClearQuery={() => setQuery('')} onMatchCount={setTodayMatches} />
          ) : roles && roles.length === 0 ? (
            <EmptyState
              onAdd={() => addRole()}
              onImport={() => csvRef.current?.click()}
              onProfile={() => setSettings({ open: true, tab: 'profile' })}
            />
          ) : query && roles && boardCount === 0 ? (
            <div className="no-match">
              <p>
                No roles match <strong>“{query}”</strong>.
              </p>
              <button type="button" className="btn" onClick={() => setQuery('')}>
                Clear filter
              </button>
            </div>
          ) : !roles && error ? null : !roles ? (
            <div className="board-loading" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton-col">
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : (
            <Board roles={roles} query={query} onOpen={openRole} onAdd={addRole} onMove={move} />
          )}
        </main>
        {chat.open && <ChatPanel onClose={() => setChat({ open: false })} onOpenSettings={(tab) => setSettings({ open: true, tab })} />}
      </div>

      <input
        ref={csvRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importCsv(f)
          e.target.value = ''
        }}
      />
      <RoleDialog
        open={dialog.open}
        role={editing}
        initialStage={dialog.stage}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onAskAssistant={(roleId) => {
          setDialog((d) => ({ ...d, open: false }))
          // The chosen role becomes the assistant's context; it stays until the user changes it.
          chatRun.setContext(roleId)
          setChat({ open: true })
        }}
      />
      <SettingsDialog open={settings.open} tab={settings.tab} onClose={() => setSettings((s) => ({ ...s, open: false }))} />
    </div>
  )
}

function EmptyState({ onAdd, onImport, onProfile }: { onAdd: () => void; onImport: () => void; onProfile: () => void }) {
  return (
    <div className="empty">
      <div className="empty-card">
        <h2>Start your board</h2>
        <p>Track every application from first look to offer. Your data stays on this computer.</p>
        <div className="empty-steps">
          <button type="button" className="empty-step is-primary" onClick={onAdd}>
            <span className="empty-icon">
              <Icon name="link" />
            </span>
            <span>
              <strong>Paste a job link</strong>
              <small>The app reads the posting and fills in the details</small>
            </span>
            <Icon name="arrowRight" className="empty-arrow" />
          </button>
          <button type="button" className="empty-step" onClick={onImport}>
            <span className="empty-icon">
              <Icon name="upload" />
            </span>
            <span>
              <strong>Import a spreadsheet</strong>
              <small>Any CSV with Company and Role columns</small>
            </span>
            <Icon name="arrowRight" className="empty-arrow" />
          </button>
          <button type="button" className="empty-step" onClick={onProfile}>
            <span className="empty-icon">
              <Icon name="user" />
            </span>
            <span>
              <strong>Set up your profile</strong>
              <small>Your resume and preferences power Find roles and autofill</small>
            </span>
            <Icon name="arrowRight" className="empty-arrow" />
          </button>
        </div>
      </div>
    </div>
  )
}
