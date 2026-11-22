/**
 * The board-adapter layer: one adapter per job board autofill supports. Each says
 * how to recognize its links, where its form may live, how the in-page agent reads
 * and fills its form, and how to plan values (around the shared matcher in match.ts).
 */
import type { AutofillBoard } from '@shared/autofill'
import { ashby } from './ashby'
import { greenhouse } from './greenhouse'
import { lever } from './lever'
import type { BoardAdapter, BoardLink } from './types'

export type { BoardAdapter, BoardLink } from './types'

export const ADAPTERS: Record<AutofillBoard, BoardAdapter> = { greenhouse, ashby, lever }

/** The board and application link for a posting URL, or null when autofill can't fill it. */
export function detectLink(url: string): BoardLink | null {
  for (const a of Object.values(ADAPTERS)) {
    const link = a.parse(url)
    if (link) return link
  }
  return null
}

export function adapterFor(board: AutofillBoard): BoardAdapter {
  return ADAPTERS[board]
}

/** The URL to open for a link, or null when it has to be resolved from a company page first. */
export function applicationUrl(link: BoardLink): string | null {
  return link.link.kind === 'company' ? null : link.link.formUrl
}
