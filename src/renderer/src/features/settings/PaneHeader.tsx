import type { ReactNode } from 'react'

/** The header every Settings pane starts with: tab name, one-line description, optional action. */
export function PaneHeader({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <header className="settings-pane-head">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </header>
  )
}
