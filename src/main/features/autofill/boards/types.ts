/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AutofillBoard } from '@shared/autofill'
import type { Profile } from '@shared/profile'
import type { FieldDescriptor } from '../fields'
import type { FillPlan } from '../match'
import type { GreenhouseLink } from '../url'

export type AshbyLink =
  /** jobs.ashbyhq.com/<org>/<id>[/application] */
  | { kind: 'hosted'; org: string; jobId: string; formUrl: string }
  /** Company page embedding Ashby with ?ashby_jid=<id>; the org is resolved when the window opens. */
  | { kind: 'company'; jobId: string; pageUrl: string; orgGuesses: string[] }

/** jobs.lever.co/<org>/<id>[/apply], also jobs.eu.lever.co. */
export interface LeverLink {
  kind: 'hosted'
  org: string
  jobId: string
  formUrl: string
}

export type BoardLink =
  | { board: 'greenhouse'; link: GreenhouseLink }
  | { board: 'ashby'; link: AshbyLink }
  | { board: 'lever'; link: LeverLink }

/**
 * Board-specific behavior for the in-page agent (see page.ts). Serialized with
 * toString() and run inside the application page's isolated world, so it must be
 * self-contained. Receives the window and the agent's text helpers; returns hooks,
 * every one optional, each returning null/undefined to fall back to the generic
 * (Greenhouse-shaped) behavior.
 */
export type PageDialect = (win: any, helpers: { clean: (s: any) => string }) => any

/** Everything the runner needs to know about one job board. Pure: no Electron. */
export interface BoardAdapter {
  board: AutofillBoard
  name: string
  /** Recognizes this board's application links. */
  parse(url: string): BoardLink | null
  /**
   * True only for an https URL on the board's own application host. Profile data is
   * inserted only into a page whose URL passes this check.
   */
  isFormUrl(url: string): boolean
  /** In-page hooks; null uses the generic behavior. */
  dialect: PageDialect | null
  /** Main-world expression that is true once the site's framework controls the form; null for server-rendered forms. */
  hydrationProbe: string | null
  /** Decides what to fill. Boards wrap the shared planFill with their own field conventions. */
  plan(fields: FieldDescriptor[], profile: Profile, now?: Date): FillPlan
}

/** https URL whose host matches. */
export function onHost(url: string, host: RegExp): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && host.test(u.hostname.toLowerCase()) && !u.username && !u.password
  } catch {
    return false
  }
}
