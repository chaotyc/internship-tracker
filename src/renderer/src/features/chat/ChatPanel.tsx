import { Icon } from '@renderer/components/Icon'

// TODO(chat feature): streaming conversation, resume-aware answers, proposed actions.
export function ChatPanel({ onClose }: { roleId: string | null; onClose: () => void }) {
  return (
    <aside className="side-panel" aria-label="Assistant">
      <header className="side-head">
        <h2>Assistant</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close assistant">
          <Icon name="close" />
        </button>
      </header>
      <div className="side-empty">The assistant arrives in the next build.</div>
    </aside>
  )
}
