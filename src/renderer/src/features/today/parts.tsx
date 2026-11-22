import type { CSSProperties } from 'react'
import { STAGES, type StageKey } from '@shared/roles'
import { Icon } from '@renderer/components/Icon'

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

/** Reads a dropped .eml (or .txt) file; refuses anything else or anything huge. */
export async function readEmailFile(file: File): Promise<string> {
  if (!/\.(eml|txt|msg)$/i.test(file.name) && !/^(message\/rfc822|text\/plain)$/.test(file.type)) throw new Error('Drop an email saved as a .eml file, or paste its text.')
  if (/\.msg$/i.test(file.name)) throw new Error('Outlook .msg files aren’t supported. Save the email as .eml, or paste its text.')
  if (file.size > 2_000_000) throw new Error('That email is too large to read here.')
  return file.text()
}
