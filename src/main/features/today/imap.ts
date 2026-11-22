import type { Role } from '@shared/roles'
import { parseEmail, type ParsedEmail } from './email'
import { headerCandidates, matchEmail } from './match'

/** One message as listed by the server: sender and subject only, no body. */
export interface HeaderSummary {
  uid: number
  from: { name: string; address: string }
  replyTo?: string
  subject: string
  date: string
}

/**
 * The read-only slice of an IMAP client the hook uses. There is deliberately no way
 * to set flags, move, delete or send.
 */
export interface MailClient {
  connect(): Promise<void>
  /** Opens INBOX with EXAMINE (read-only). */
  openInboxReadOnly(): Promise<{ uidValidity: string }>
  /** Headers (envelope) of messages received on or after `since`. */
  listHeaders(since: Date): Promise<HeaderSummary[]>
  /** Full source of one message, fetched with BODY.PEEK so it stays unread. */
  fetchSource(uid: number): Promise<Uint8Array | null>
  close(): Promise<void>
}

export interface ImapConfig {
  host: string
  port: number
  user: string
  password: string
}

/** Wraps imapflow: implicit TLS only, certificate checked, logging off (it would include the login). */
export async function imapflowClient(cfg: ImapConfig): Promise<MailClient> {
  const { ImapFlow } = await import('imapflow')
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    disableAutoIdle: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  })
  client.on('error', () => {
    // Surfaced through the failing call instead; without a listener Node would throw.
  })
  let release: (() => void) | null = null
  return {
    connect: () => client.connect(),
    async openInboxReadOnly() {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      release = () => lock.release()
      const box = client.mailbox
      return { uidValidity: box ? String(box.uidValidity) : '' }
    },
    async listHeaders(since) {
      const uids = await client.search({ since }, { uid: true })
      if (!uids || !uids.length) return []
      const recent = uids.slice(-500)
      const msgs = await client.fetchAll(recent.join(','), { uid: true, envelope: true }, { uid: true })
      return msgs.map((m) => {
        const f = m.envelope?.from?.[0]
        const r = m.envelope?.replyTo?.[0]
        const d = m.envelope?.date
        return {
          uid: m.uid,
          from: { name: f?.name ?? '', address: (f?.address ?? '').toLowerCase() },
          replyTo: (r?.address ?? '').toLowerCase(),
          subject: m.envelope?.subject ?? '',
          date: d ? new Date(d).toISOString() : '',
        }
      })
    },
    async fetchSource(uid) {
      const m = await client.fetchOne(String(uid), { uid: true, source: { maxLength: 512 * 1024 } }, { uid: true })
      return m && m.source ? new Uint8Array(m.source) : null
    },
    async close() {
      release?.()
      try {
        await client.logout()
      } catch {
        client.close()
      }
    },
  }
}

export interface CheckState {
  uidValidity: string
  /** Highest UID already looked at (with the same uidValidity), or 0. */
  lastUid: number
  since: Date
}

export interface CheckResult {
  uidValidity: string
  lastUid: number
  scanned: number
  /** Messages whose sender/subject pointed at a company on the board (bodies fetched). */
  candidates: number
  /** Messages that matched a role after reading the body. */
  matched: number
}

/** Bodies fetched per check, at most; the rest wait for the next check. */
export const MAX_BODIES = 25

/**
 * One inbox check: list new headers, keep only those that point at a company on the
 * board, fetch just those bodies, match each to a role and hand matches to `onMatch`.
 * Everything else is never downloaded and never reaches the AI.
 */
export async function checkInbox(
  client: MailClient,
  roles: Role[],
  state: CheckState,
  onMatch: (email: ParsedEmail, role: Role) => Promise<void>,
): Promise<CheckResult> {
  await client.connect()
  try {
    const { uidValidity } = await client.openInboxReadOnly()
    const sameBox = uidValidity === state.uidValidity
    const headers = (await client.listHeaders(state.since)).filter((h) => !sameBox || h.uid > state.lastUid).sort((a, b) => a.uid - b.uid)
    const lastUidSeen = headers.reduce((n, h) => Math.max(n, h.uid), sameBox ? state.lastUid : 0)
    const candidates = headers.filter((h) => headerCandidates(h, roles).length > 0)
    const batch = candidates.slice(0, MAX_BODIES)
    // If more matched than one batch, stop the cursor before the first one left over.
    const lastUid = candidates.length > batch.length ? candidates[batch.length]!.uid - 1 : lastUidSeen
    let matched = 0
    for (const h of batch) {
      const src = await client.fetchSource(h.uid)
      if (!src) continue
      const email = await parseEmail(src)
      const m = matchEmail(email, roles)
      if (!m) continue
      matched++
      await onMatch(email, m.role)
    }
    return { uidValidity, lastUid, scanned: headers.length, candidates: batch.length, matched }
  } finally {
    await client.close()
  }
}

/** Turns library errors into something a person can act on. */
export function friendlyImapError(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string }
  if (e?.authenticationFailed || /auth|credentials|login/i.test(e?.responseText ?? '')) return 'The server turned down that user name and app password.'
  if (e?.code === 'ENOTFOUND') return "Couldn't find that mail server. Check the host name."
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ConnectionTimeout' || e?.code === 'GreetingTimeout')
    return "Couldn't reach the mail server. Check the host and port (usually 993) and your connection."
  if (/certificate|self.signed|TLS/i.test(e?.message ?? '')) return "The mail server's security certificate couldn't be verified."
  return e?.message || 'Something went wrong talking to the mail server.'
}
