import { useState } from 'react'
import { Dialog } from '@renderer/components/Dialog'
import { Icon, type IconName } from '@renderer/components/Icon'
import { WatchlistPanel } from '@renderer/features/search/WatchlistPanel'
import { AiPanel } from './AiPanel'
import { DataPanel } from './DataPanel'
import { ProfilePanel } from './ProfilePanel'
import './settings.css'

export type SettingsTab = 'profile' | 'ai' | 'boards' | 'data'

const TABS: { key: SettingsTab; label: string; icon: IconName; hint: string }[] = [
  { key: 'profile', label: 'Profile', icon: 'user', hint: 'Used to fill applications and judge fit' },
  { key: 'ai', label: 'AI connections', icon: 'sparkle', hint: 'Claude, ChatGPT or Gemini' },
  { key: 'boards', label: 'Job boards', icon: 'list', hint: 'Companies autosearch checks' },
  { key: 'data', label: 'Data & privacy', icon: 'database', hint: 'Export or erase' },
]

export function SettingsDialog({ open, tab, onClose }: { open: boolean; tab: SettingsTab; onClose: () => void }) {
  const [active, setActive] = useState<SettingsTab>(tab)
  const [lastTab, setLastTab] = useState(tab)
  if (tab !== lastTab) {
    setLastTab(tab)
    setActive(tab)
  }
  const current = TABS.find((t) => t.key === active)!
  return (
    <Dialog open={open} onClose={onClose} width={900} title="Settings" subtitle="Everything stays on this computer.">
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`settings-tab${t.key === active ? ' is-active' : ''}`}
              aria-current={t.key === active ? 'page' : undefined}
              onClick={() => setActive(t.key)}
            >
              <Icon name={t.icon} />
              <span>
                {t.label}
                <small>{t.hint}</small>
              </span>
            </button>
          ))}
        </nav>
        <section className="settings-pane" aria-label={current.label}>
          {active === 'profile' && <ProfilePanel />}
          {active === 'ai' && <AiPanel />}
          {active === 'boards' && <WatchlistPanel />}
          {active === 'data' && <DataPanel />}
        </section>
      </div>
    </Dialog>
  )
}
