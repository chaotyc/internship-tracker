import type { Role, StageKey } from '@shared/roles'
import { domainOf } from './email'

/**
 * Matching an email to a role happens entirely on this machine. It's also the gate
 * for privacy: an email that matches no role is never fetched in full from the inbox
 * and never reaches the AI.
 */

/** Applicant-tracking and assessment services that send mail on a company's behalf. */
export const ATS_DOMAINS = [
  'greenhouse-mail.io',
  'greenhouse.io',
  'ashbyhq.com',
  'hire.lever.co',
  'lever.co',
  'myworkday.com',
  'myworkdayjobs.com',
  'workday.com',
  'codesignal.com',
  'hackerrank.com',
  'hackerrankforwork.com',
  'codility.com',
  'coderpad.io',
  'smartrecruiters.com',
  'icims.com',
  'jobvite.com',
  'workablemail.com',
  'gem.com',
  'goodtime.io',
  'hirevue.com',
  'karat.com',
  'rippling.com',
  'bamboohr.com',
]

/** Mailbox providers: a sender here says nothing about the company. */
const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'fastmail.com',
])

const CAREER_SUFFIXES = ['', 'careers', 'jobs', 'recruiting', 'talent', 'hr', 'hiring', 'mail', 'team', 'inc', 'hq', 'ai', 'labs']

export const RECRUITING_WORDS =
  /\b(application|applying|applied|interview\w*|assessment|coding challenge|take[- ]home|offer|recruit\w*|candidate|candidacy|position|role|opportunit\w+|intern(ship)?s?|hiring|next steps?|phone screen|onsite|unfortunately|talent)\b/i

const PUNCT = /[^\p{L}\p{N}]+/gu

export function isAtsDomain(domain: string): boolean {
  return ATS_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))
}

/** "Cobaltine AI, Inc." → "cobaltineai" */
export function compactName(company: string): string {
  return company
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(inc|llc|ltd|corp|corporation|co|gmbh|plc)\b\.?/g, ' ')
    .replace(PUNCT, '')
}

/** The labels of a domain that can name a company: "mail.vectorline.com" → ["vectorline", "vectorlinecom"…]. */
function domainNames(domain: string): string[] {
  const labels = domain.split('.').filter(Boolean)
  if (labels.length < 2) return []
  const twoPart = labels.length >= 3 && /^(co|com|org|ac|net)$/.test(labels[labels.length - 2]!) && labels[labels.length - 1]!.length === 2
  const baseIdx = labels.length - (twoPart ? 3 : 2)
  const base = labels[baseIdx]!.replace(PUNCT, '')
  const tld = labels[labels.length - 1]!
  return [base, base + tld]
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** True when a sender's domain belongs to the company (vectorline.com, kitecareers.com, cobaltine.ai). */
export function domainMatchesCompany(domain: string, role: Pick<Role, 'company' | 'link'>): boolean {
  if (!domain || PERSONAL_DOMAINS.has(domain) || isAtsDomain(domain)) return false
  const compact = compactName(role.company)
  if (compact.length < 2) return false
  const firstWord = compactName(role.company.split(/\s+/)[0] ?? '')
  for (const name of domainNames(domain)) {
    if (name === compact) return true
    if (name.startsWith(compact) && CAREER_SUFFIXES.includes(name.slice(compact.length))) return true
    // "Cobaltine AI" at cobaltine.ai, "Prism Labs" at prismlabs.com is covered above.
    if (firstWord.length >= 5 && firstWord !== compact && name === firstWord) return true
  }
  const linkHost = hostOf(role.link)
  if (linkHost && !isAtsDomain(linkHost)) {
    const [a] = domainNames(linkHost)
    const [b] = domainNames(domain)
    if (a && b && a === b) return true
  }
  return false
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The company's name as a whole word or phrase ("Kite" doesn't match "metadata"). */
export function mentionsCompany(text: string, company: string): boolean {
  const name = company.replace(/\(.*?\)/g, '').replace(/,?\s+(inc|llc|ltd|corp)\.?$/i, '').trim()
  if (name.length < 2 || !text) return false
  const words = name.split(/\s+/).map(escapeRe).join('[\\s\\-]*')
  return new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

export interface HeaderInfo {
  from: { name: string; address: string }
  replyTo?: string
  subject: string
}

export type Confidence = 'strong' | 'medium'

interface CompanyHit {
  confidence: Confidence
  reason: string
}

/** Signals in the sender and subject alone. Used to decide whether to fetch a body at all. */
function headerHit(h: HeaderInfo, role: Role): CompanyHit | null {
  const domain = domainOf(h.from.address)
  const local = h.from.address.split('@')[0]?.toLowerCase().replace(PUNCT, '') ?? ''
  const compact = compactName(role.company)
  if (domainMatchesCompany(domain, role)) return { confidence: 'strong', reason: `sent from ${domain}` }
  if (h.replyTo && domainMatchesCompany(domainOf(h.replyTo), role)) return { confidence: 'strong', reason: `replies go to ${domainOf(h.replyTo)}` }
  const inName = mentionsCompany(h.from.name, role.company)
  const inSubject = mentionsCompany(h.subject, role.company)
  if (isAtsDomain(domain)) {
    if (inName || inSubject || (compact.length >= 3 && local === compact))
      return { confidence: 'strong', reason: `${role.company} via ${domain}` }
    return null
  }
  if (inName) return { confidence: 'medium', reason: `sender is ${h.from.name}` }
  if (inSubject && RECRUITING_WORDS.test(h.subject)) return { confidence: 'medium', reason: `subject mentions ${role.company}` }
  return null
}

/**
 * Header-only pre-filter for the inbox: the roles this email might be about, judged
 * from sender and subject. An empty list means the body is never downloaded.
 */
export function headerCandidates(h: HeaderInfo, roles: Role[]): Role[] {
  return roles.filter((r) => headerHit(h, r))
}

export interface EmailForMatch extends HeaderInfo {
  text: string
}

export interface RoleMatch {
  role: Role
  confidence: Confidence
  reason: string
}

const STAGE_WEIGHT: Record<StageKey, number> = { interviewing: 0, offer: 1, applied: 2, saved: 3, rejected: 4, closed: 5 }
const GENERIC_TITLE = new Set(['intern', 'internship', 'the', 'and', 'for', 'with', 'summer', 'fall', 'spring', 'winter', '2025', '2026', '2027', '2028'])

function titleOverlap(title: string, text: string): number {
  const hay = text.toLowerCase()
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((w) => w.length >= 3 && !GENERIC_TITLE.has(w))
    .reduce((n, w) => n + (new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'iu').test(hay) ? 1 : 0), 0)
}

/**
 * Picks the role an email is about, or null. `lenient` (for emails the user pasted
 * on purpose) also accepts a company named only in the body of a recruiting email.
 */
export function matchEmail(email: EmailForMatch, roles: Role[], opts: { lenient?: boolean } = {}): RoleMatch | null {
  const domain = domainOf(email.from.address)
  const body = email.text.slice(0, 20_000)
  const recruiting = RECRUITING_WORDS.test(email.subject) || RECRUITING_WORDS.test(body)
  const hits: (RoleMatch & { score: number })[] = []
  for (const role of roles) {
    let hit = headerHit(email, role)
    if (!hit && isAtsDomain(domain) && recruiting && mentionsCompany(body, role.company))
      hit = { confidence: 'strong', reason: `${role.company} via ${domain}` }
    if (!hit && opts.lenient && recruiting && mentionsCompany(body, role.company)) hit = { confidence: 'medium', reason: `the email mentions ${role.company}` }
    if (!hit) continue
    const score = (hit.confidence === 'strong' ? 100 : 50) + titleOverlap(role.title, email.subject + '\n' + body) * 5 - STAGE_WEIGHT[role.stage]
    hits.push({ role, ...hit, score })
  }
  if (!hits.length) return null
  hits.sort((a, b) => b.score - a.score || b.role.updatedAt.localeCompare(a.role.updatedAt))
  const { score: _s, ...best } = hits[0]!
  return best
}
