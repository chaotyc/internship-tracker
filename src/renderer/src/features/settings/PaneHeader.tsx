import type { ReactNode } from 'react'

/**
 * The header every Settings pane starts with: tab name, optional action, and a one-line description
 * only when it adds something the nav hint doesn't already say.
 */
export function PaneHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="settings-pane-head">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  )
}
