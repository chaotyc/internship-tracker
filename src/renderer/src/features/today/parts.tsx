import type { CSSProperties } from 'react'
import { STAGES, type StageKey } from '@shared/roles'

export const stageLabel = (k: StageKey) => STAGES.find((s) => s.key === k)?.label ?? k
export const stageStyle = (k: StageKey) => ({ ['--stage' as string]: `var(--stage-${k})` }) as CSSProperties

/** Envelope icon (the shared icon set has none). */
export function MailIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
    </svg>
  )
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
export function sinceLabel(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!t) return ''
  const min = Math.round((now - t) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Reads a dropped .eml (or .txt) file; refuses anything else or anything huge. */
export async function readEmailFile(file: File): Promise<string> {
  if (!/\.(eml|txt|msg)$/i.test(file.name) && !/^(message\/rfc822|text\/plain)$/.test(file.type)) throw new Error('Drop an email saved as a .eml file, or paste its text.')
  if (/\.msg$/i.test(file.name)) throw new Error('Outlook .msg files aren’t supported. Save the email as .eml, or paste its text.')
  if (file.size > 2_000_000) throw new Error('That email is too large to read here.')
  return file.text()
}
