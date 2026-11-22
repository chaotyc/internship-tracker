import { STAGES, type Role, type StageKey } from '@shared/roles'
import { addDays, isIsoDate, localIso } from '@shared/today'
import type { ParsedEmail } from './email'

/** What a proposal changes, before it's stored. */
export interface ProposalDraft {
  summary: string
  stage: StageKey | null
  nextStep: { text: string; due: string; time: string } | null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14 }

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const TIME_RE = /\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\b([01]?\d|2[0-3]):([0-5]\d)\b/i

function ymd(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${y}-${p(m)}-${p(d)}`
}

/** A month and day without a year: this year, unless that was more than two months ago. */
function inferYear(month: number, day: number, ref: string): string {
  const year = Number(ref.slice(0, 4))
  const guess = ymd(year, month, day)
  const back = (Date.parse(ref) - Date.parse(guess)) / 86_400_000
  return back > 60 ? ymd(year + 1, month, day) : guess
}

function timeNear(text: string, from: number): string {
  const window = text.slice(from, from + 48)
  const m = TIME_RE.exec(window)
  if (!m) return ''
  if (m[4] != null) return `${m[4].padStart(2, '0')}:${m[5]}`
  let h = Number(m[1])
  const min = m[2] ?? '00'
  const pm = /^p/i.test(m[3]!)
  if (h < 1 || h > 12) return ''
  if (pm && h < 12) h += 12
  if (!pm && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${min}`
}

interface Found {
  at: number
  due: string
  time: string
}

/**
 * Dates written in an email ("Thursday, Nov 24 at 2:00 PM", "11/24", "within 5 days",
 * "by Friday"), resolved against the day it was sent. Returns the first one on or
 * after that day.
 */
export function extractDate(text: string, ref: string): { due: string; time: string } | null {
  const found: Found[] = []
  const push = (at: number, due: string, end: number) => {
    if (isIsoDate(due)) found.push({ at, due, time: timeNear(text, end) })
  }
  let m: RegExpExecArray | null
  const iso = /\b(20\d\d)-(\d{2})-(\d{2})\b/g
  while ((m = iso.exec(text))) push(m.index, m[0], m.index + m[0].length)
  const md = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(20\\d\\d))?`, 'gi')
  while ((m = md.exec(text))) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1
    const day = Number(m[2])
    push(m.index, m[3] ? ymd(Number(m[3]), month, day) : inferYear(month, day, ref), m.index + m[0].length)
  }
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+(20\\d\\d))?`, 'gi')
  while ((m = dm.exec(text))) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1
    const day = Number(m[1])
    push(m.index, m[3] ? ymd(Number(m[3]), month, day) : inferYear(month, day, ref), m.index + m[0].length)
  }
  const num = /\b(1[0-2]|0?[1-9])\/([12]\d|3[01]|0?[1-9])(?:\/(20\d\d|\d\d))?\b/g
  while ((m = num.exec(text))) {
    const month = Number(m[1])
    const day = Number(m[2])
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : 0
    push(m.index, y ? ymd(y, month, day) : inferYear(month, day, ref), m.index + m[0].length)
  }
  const wd = /\b(?:on|this|next|by|until|before)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi
  while ((m = wd.exec(text))) {
    const target = WEEKDAYS.indexOf(m[1]!.toLowerCase())
    const dow = new Date(ref + 'T12:00:00').getDay()
    const ahead = ((target - dow + 7) % 7) || 7
    push(m.index, addDays(ref, ahead), m.index + m[0].length)
  }
  const tomorrow = /\btomorrow\b/gi
  while ((m = tomorrow.exec(text))) push(m.index, addDays(ref, 1), m.index + m[0].length)
  const within = /\b(?:within|in the next|next)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen)\s+(business\s+|calendar\s+)?(days?|hours?|weeks?)\b|\b(\d{1,2}|one|two|three|four|five|six|seven|ten|fourteen)\s+(days?)\s+to\s+complete\b/gi
  while ((m = within.exec(text))) {
    const raw = (m[1] ?? m[4] ?? '').toLowerCase()
    const n = Number(raw) || NUMBER_WORDS[raw] || 0
    const unit = (m[3] ?? m[5] ?? '').toLowerCase()
    const days = unit.startsWith('hour') ? Math.max(1, Math.ceil(n / 24)) : unit.startsWith('week') ? n * 7 : n
    if (n) found.push({ at: m.index, due: addDays(ref, days), time: '' })
  }
  const upcoming = found.filter((f) => f.due >= ref).sort((a, b) => a.at - b.at)
  const first = upcoming[0]
  return first ? { due: first.due, time: first.time } : null
}

const ORDER: Record<StageKey, number> = { saved: 0, applied: 1, interviewing: 2, offer: 3, rejected: 9, closed: 9 }

/** Only forward moves: an email shouldn't pull an offer back to Interviewing. */
export function stageChange(current: StageKey, proposed: StageKey | null): StageKey | null {
  if (!proposed || proposed === current) return null
  if (current === 'rejected' || current === 'closed') return null
  if (proposed === 'rejected' || proposed === 'closed') return proposed
  return ORDER[proposed] > ORDER[current] ? proposed : null
}

const REJECTION =
  /\bunfortunately\b|\bnot (?:be )?moving forward\b|\bmove forward with other candidates\b|\bdecided (?:not )?to (?:pursue|proceed with) other\b|\bwill not be (?:moving|proceeding)\b|\bregret to inform\b|\bno longer (?:under consideration|being considered)\b|\bposition has been filled\b|\bnot (?:been )?selected\b|\bpursue other candidates\b/i
const OFFER = /\b(?:pleased|delighted|excited|happy|thrilled) to (?:extend|offer)\b|\boffer letter\b|\bextend (?:you )?an? (?:internship )?offer\b|\bverbal offer\b/i
const TAKE_HOME = /\btake[- ]home\b/i
const ASSESSMENT = /\b(?:online |technical |coding )?assessment\b|\bcoding challenge\b|\bonline test\b|\bcodesignal\b|\bhackerrank\b|\bcodility\b|\bcoderpad\b/i
const INTERVIEW = /\binterview\w*\b|\bphone screen\b|\btechnical screen\b|\brecruiter (?:call|screen|chat)\b|\bonsite\b|\bon-site\b|\bsuperday\b/i
const SCHEDULING = /\bschedul\w+\b|\byour availability\b|\bbook a time\b|\bpick a time\b|\bselect a time\b|\bcalendly\b|\bgoodtime\b/i
const RECEIVED =
  /\bthanks? (?:you )?for (?:applying|your application|your interest)\b|\breceived your application\b|\bapplication (?:has been |was )?(?:received|submitted)\b|\bwe(?:'ve| have) received\b/i

/**
 * A proposal from keyword rules, for when no AI is connected. Conservative: it
 * returns null rather than guess.
 */
export function ruleProposal(email: Pick<ParsedEmail, 'subject' | 'text' | 'date'>, role: Pick<Role, 'company' | 'stage'>, today = localIso()): ProposalDraft | null {
  const all = `${email.subject}\n${email.text}`
  const sent = email.date ? localIso(new Date(email.date)) : today
  const ref = sent <= today ? sent : today
  const date = extractDate(all, ref)
  const label = (k: StageKey) => STAGES.find((s) => s.key === k)!.label
  const stageTo = (k: StageKey) => stageChange(role.stage, k)

  if (REJECTION.test(all) && !OFFER.test(all) && !SCHEDULING.test(email.subject)) {
    const stage = stageTo('rejected')
    return stage ? { summary: `${role.company} isn't moving forward with your application.`, stage, nextStep: null } : null
  }
  if (OFFER.test(all)) {
    return {
      summary: `${role.company} is making you an offer.`,
      stage: stageTo('offer'),
      nextStep: { text: date ? 'Respond to the offer' : 'Review the offer and reply', due: date?.due ?? '', time: date?.time ?? '' },
    }
  }
  if (TAKE_HOME.test(all) || ASSESSMENT.test(all)) {
    const what = TAKE_HOME.test(all) ? 'take-home' : 'online assessment'
    return {
      summary: `${role.company} sent a${what === 'take-home' ? '' : 'n'} ${what}${date ? `, due ${date.due}` : ''}.`,
      stage: stageTo('interviewing'),
      nextStep: { text: what === 'take-home' ? 'Finish the take-home' : 'Complete the online assessment', due: date?.due ?? '', time: date?.time ?? '' },
    }
  }
  if (INTERVIEW.test(all)) {
    const scheduling = SCHEDULING.test(all) && !(date && date.time)
    const kind = /\bphone screen\b/i.test(all) ? 'phone screen' : /\btechnical screen\b/i.test(all) ? 'technical screen' : 'interview'
    const a = kind === 'interview' ? 'an' : 'a'
    return {
      summary: scheduling ? `${role.company} wants to schedule ${a} ${kind}.` : `${role.company} set up ${a} ${kind}${date ? ` on ${date.due}` : ''}.`,
      stage: stageTo('interviewing'),
      nextStep: scheduling
        ? { text: `Reply with your availability for the ${kind}`, due: date && !date.time ? date.due : '', time: '' }
        : { text: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} with ${role.company}`, due: date?.due ?? '', time: date?.time ?? '' },
    }
  }
  if (RECEIVED.test(all)) {
    const stage = stageTo('applied')
    return stage ? { summary: `${role.company} received your application; moving it to ${label(stage)}.`, stage, nextStep: null } : null
  }
  return null
}
