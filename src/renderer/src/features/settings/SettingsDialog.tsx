import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@renderer/components/Dialog'
import { Icon, type IconName } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import { WatchlistPanel } from '@renderer/features/search/WatchlistPanel'
import { EmailPanel } from '@renderer/features/today/EmailPanel'
import { TracksPanel } from '@renderer/features/tracks/TracksPanel'
import { AiPanel } from './AiPanel'
import { DataPanel } from './DataPanel'
import { ProfilePanel, type ProfileActions } from './ProfilePanel'
import './settings.css'

export type SettingsTab = 'profile' | 'tracks' | 'ai' | 'boards' | 'email' | 'data'

const TABS: { key: SettingsTab; label: string; icon: IconName; hint: string }[] = [
  { key: 'profile', label: 'Profile', icon: 'user', hint: 'Fills applications and judges fit' },
  { key: 'tracks', label: 'Application tracks', icon: 'file', hint: 'A resume per kind of role' },
  { key: 'ai', label: 'AI connections', icon: 'sparkle', hint: 'Claude, OpenAI or Gemini' },
  { key: 'boards', label: 'Job boards', icon: 'list', hint: 'Companies to watch' },
  { key: 'email', label: 'Email updates', icon: 'mail', hint: 'Turn emails into next steps' },
  { key: 'data', label: 'Data & privacy', icon: 'database', hint: 'Export or erase' },
]

/** Where the user was going when unsaved Profile edits stopped them. */
type Leave = SettingsTab | 'close' | 'tour'

export function SettingsDialog({ open, tab, onClose, onShowTour }: { open: boolean; tab: SettingsTab; onClose: () => void; onShowTour?: () => void }) {
  const [active, setActive] = useState<SettingsTab>(tab)
  // Every open starts on the requested tab, even when it's the same one as last time
  // (e.g. "Open AI connections" twice, with a visit to Profile in between).
  const [last, setLast] = useState({ open, tab })
  if (open !== last.open || tab !== last.tab) {
    setLast({ open, tab })
    if (open) setActive(tab)
  }
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState<Leave | null>(null)
  const [saving, setSaving] = useState(false)
  const [version, setVersion] = useState('')
  useEffect(() => {
    if (!open || version) return
    api
      .invoke('profile:status')
      .then((st) => setVersion(st.version))
      .catch(() => {})
  }, [open, version])
  const profile = useRef<ProfileActions>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  const current = TABS.find((t) => t.key === active)!

  // Fade the bottom of the scrolling part only while there's more below. Panels
  // swap their .settings-scroll (loading -> loaded, tab changes), so watch the pane.
  useEffect(() => {
    const pane = paneRef.current
    if (!open || !pane) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        for (const el of pane.querySelectorAll<HTMLElement>('.settings-scroll')) {
          el.classList.toggle('has-more', el.scrollHeight - el.scrollTop - el.clientHeight > 2)
        }
      })
    }
    update()
    pane.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    const resize = new ResizeObserver(update)
    resize.observe(pane)
    const mutation = new MutationObserver(update)
    mutation.observe(pane, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      pane.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      resize.disconnect()
      mutation.disconnect()
    }
  }, [open])

  useEffect(() => {
    if (pending) keepRef.current?.focus()
  }, [pending])
  // Saved another way (Cmd+S) while the prompt was up: nothing left to ask about.
  useEffect(() => {
    if (!dirty) setPending(null)
  }, [dirty])

  const go = (to: Leave) => {
    setPending(null)
    if (to === 'close') onClose()
    else if (to === 'tour') onShowTour?.()
    else setActive(to)
  }
  const leave = (to: Leave) => {
    if (to === active) return
    if (active === 'profile' && dirty) setPending(to)
    else go(to)
  }
  const saveAndLeave = async () => {
    if (!pending || saving) return
    setSaving(true)
    const ok = (await profile.current?.save()) ?? false
    setSaving(false)
    // If the save didn't go through, stay so the user can see what needs fixing.
    if (ok) go(pending)
    else setPending(null)
  }
  const discardAndLeave = () => {
    if (!pending) return
    profile.current?.discard()
    go(pending)
  }

  return (
    <Dialog
      open={open}
      onClose={() => leave('close')}
      width={900}
      title="Settings"
      flush
    >
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`settings-tab${t.key === active ? ' is-active' : ''}`}
              aria-current={t.key === active ? 'page' : undefined}
              onClick={() => leave(t.key)}
            >
              <Icon name={t.icon} />
              <span>
                {t.label}
                <small>{t.hint}</small>
              </span>
            </button>
          ))}
          {onShowTour && (
            <button type="button" className="settings-tab settings-tour" onClick={() => leave('tour')}>
              <Icon name="flag" />
              <span>
                Show welcome tour
                <small>Setup steps and a quick tour</small>
              </span>
            </button>
          )}
          {version && <p className={`settings-version${onShowTour ? '' : ' is-alone'}`}>Internship Tracker {version}</p>}
        </nav>
        <section ref={paneRef} className={`settings-pane${pending ? ' is-confirming' : ''}`} aria-label={current.label}>
          {active === 'profile' ? (
            <ProfilePanel actions={profile} onDirtyChange={setDirty} />
          ) : (
            <div key={active} className="settings-scroll">
              {active === 'tracks' && <TracksPanel />}
              {active === 'ai' && <AiPanel />}
              {active === 'boards' && <WatchlistPanel />}
              {active === 'email' && <EmailPanel />}
              {active === 'data' && <DataPanel />}
            </div>
          )}
          {pending && (
            <div className="settings-confirm" role="alertdialog" aria-labelledby="settings-confirm-t" aria-describedby="settings-confirm-d">
              <Icon name="alert" />
              <div className="settings-confirm-text">
                <strong id="settings-confirm-t">You have unsaved changes</strong>
                <span id="settings-confirm-d">
                  {pending === 'close' || pending === 'tour' ? 'Save your profile before closing Settings?' : `Save your profile before going to ${TABS.find((t) => t.key === pending)!.label}?`}
                </span>
              </div>
              <button ref={keepRef} type="button" className="btn btn-ghost" onClick={() => setPending(null)} disabled={saving}>
                Keep editing
              </button>
              <button type="button" className="btn" onClick={discardAndLeave} disabled={saving}>
                Discard
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveAndLeave()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  )
}
