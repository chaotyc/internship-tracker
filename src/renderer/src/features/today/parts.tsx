import type { CSSProperties } from 'react'
import { STAGES, type StageKey } from '@shared/roles'
import { localIso } from '@shared/today'
import { Icon } from '@renderer/components/Icon'
import { since } from '@renderer/lib/format'

export const stageLabel = (k: StageKey) => STAGES.find((s) => s.key === k)?.label ?? k
export const stageStyle = (k: StageKey) => ({ ['--stage' as string]: `var(--stage-${k})` }) as CSSProperties

/** Envelope icon, from the shared set. */
export function MailIcon(props: { className?: string }) {
  return <Icon name="mail" {...props} />
}

export function ShieldIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />
    </svg>
  )
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className="td-switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="td-switch-track" aria-hidden="true" />
      <span className="td-switch-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

/** "just now", "5 min ago", "2 h ago", or a date. */
/** Kept for existing imports; the one relative-time rule lives in lib/format. */
export function sinceLabel(iso: string, now = Date.now()): string {
  return since(iso, now)
}

/** Reads a dropped .eml (or .txt) file; refuses anything else or anything huge. */
export async function readEmailFile(file: File): Promise<string> {
  if (!/\.(eml|txt|msg)$/i.test(file.name) && !/^(message\/rfc822|text\/plain)$/.test(file.type)) throw new Error('Drop an email saved as a .eml file, or paste its text.')
  if (/\.msg$/i.test(file.name)) throw new Error('Outlook .msg files aren’t supported. Save the email as .eml, or paste its text.')
  if (file.size > 2_000_000) throw new Error('That email is too large to read here.')
  return file.text()
}
