// One mapping for the tray and the role a suggestion becomes.
export { fitFromScore } from '@shared/search'

export interface BoardFailure {
  /** Short, plain reason, e.g. "Lever didn't respond". */
  text: string
  /** `danger` only when the board itself is gone; everything else is likely transient. */
  tone: 'warn' | 'danger'
}

/** Turns a raw board-read error into one plain line. The raw error stays in the tooltip. */
export function boardFailure(board: string, error: string): BoardFailure {
  if (/answered 4(?:04|10)\b|^No \w+ board named|isn't a Workday careers site/i.test(error))
    return { text: `${board} board not found`, tone: 'danger' }
  if (/took too long|couldn't reach|timed? ?out|network/i.test(error)) return { text: `${board} didn't respond`, tone: 'warn' }
  return { text: `${board} couldn't be read`, tone: 'warn' }
}
