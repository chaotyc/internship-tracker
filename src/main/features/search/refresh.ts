/** Refresh: check that every Saved role's posting is still up, and flag deadlines that are close. */
import type { Liveness, Role } from '@shared/roles'
import type { RefreshResult } from '@shared/search'
import { fetchPosting, parsePostingUrl, type JobPosting } from './boards'
import { HttpError, getText, mapLimit } from './http'
import { closedPhrase, htmlToText } from './html'

export const EXPIRING_DAYS = 7
const DAY = 86_400_000

/** Whole days from `now` to an ISO date (local calendar days), or null. */
export function daysUntil(iso: string, now = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  return Math.round((d.getTime() - today.getTime()) / DAY)
}

export interface Check {
  /** 'live' means the posting is up; the deadline then decides open vs expiring. */
  state: 'live' | 'closed'
  detail: string
  /** A deadline the board lists, when the role has none. */
  deadline?: string
}

/** Applies the deadline rules to a check of the posting itself. */
export function livenessFor(check: Check, roleDeadline: string, now = new Date()): Liveness {
  const checkedAt = now.toISOString()
  if (check.state === 'closed') return { status: 'closed', checkedAt, detail: check.detail }
  const deadline = roleDeadline || check.deadline || ''
  const d = daysUntil(deadline, now)
  if (d != null && d < 0) return { status: 'closed', checkedAt, detail: `The deadline (${deadline}) has passed.` }
  if (d != null && d <= EXPIRING_DAYS)
    return { status: 'expiring', checkedAt, detail: d === 0 ? 'Applications are due today.' : `Applications are due in ${d} day${d === 1 ? '' : 's'} (${deadline}).` }
  return { status: 'open', checkedAt, detail: check.detail }
}

/** Checks one posting link. Throws when the posting can't be checked (network, board down). */
export async function checkLink(link: string, opts: { signal?: AbortSignal; boardCache?: Map<string, Promise<JobPosting[]>> } = {}): Promise<Check> {
  const ref = parsePostingUrl(link)
  if (ref) {
    let posting: JobPosting | null
    try {
      posting = await fetchPosting(ref, { pageUrl: link, ...opts })
    } catch (err) {
      if (ref.slug) throw err
      // An embedded link whose board we couldn't find: read the page instead.
      return checkPage(link, opts.signal)
    }
    if (!posting) return { state: 'closed', detail: 'The job board no longer lists this posting.' }
    return { state: 'live', detail: 'Still listed on the job board.', deadline: posting.deadline || undefined }
  }
  return checkPage(link, opts.signal)
}

async function checkPage(link: string, signal?: AbortSignal): Promise<Check> {
  try {
    const page = await getText(link, { signal, timeoutMs: 20_000 })
    const phrase = closedPhrase(htmlToText(page.text, 60_000))
    if (phrase) return { state: 'closed', detail: `The page says “${phrase}”.` }
    return { state: 'live', detail: 'The page is still up.' }
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 410))
      return { state: 'closed', detail: `The page is gone (${err.status}).` }
    throw err
  }
}

export interface RefreshDeps {
  roles: Role[]
  update: (id: string, liveness: Liveness) => void
  now?: () => Date
  signal?: AbortSignal
  check?: typeof checkLink
}

/** Checks every Saved role with a link and writes its liveness. */
export async function refreshRoles(deps: RefreshDeps): Promise<RefreshResult> {
  const now = deps.now ?? (() => new Date())
  const check = deps.check ?? checkLink
  const targets = deps.roles.filter((r) => r.stage === 'saved' && /^https?:\/\//i.test(r.link.trim()))
  const result: RefreshResult = { checked: 0, closed: [], expiring: [], failed: [] }
  const boardCache = new Map<string, Promise<JobPosting[]>>()
  await mapLimit(targets, 4, async (role) => {
    try {
      const c = await check(role.link.trim(), { signal: deps.signal, boardCache })
      const live = livenessFor(c, role.deadline, now())
      deps.update(role.id, live)
      result.checked++
      if (live.status === 'closed') result.closed.push({ id: role.id, company: role.company, title: role.title })
      else if (live.status === 'expiring') result.expiring.push({ id: role.id, company: role.company, title: role.title, deadline: role.deadline || c.deadline || '' })
    } catch (err) {
      result.failed.push({ id: role.id, company: role.company, detail: err instanceof Error ? err.message : String(err) })
    }
  })
  return result
}
