/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Lever (jobs.lever.co, jobs.eu.lever.co). A server-rendered form with jQuery:
 * plain inputs, a location autocomplete fed by /searchLocations, custom questions
 * named `cards[<id>][fieldN]`, and native EEO selects (`eeo[gender]` and so on).
 */
import type { Profile } from '@shared/profile'
import type { FieldDescriptor } from '../fields'
import { planFill, type FillPlan } from '../match'
import { onHost, type BoardAdapter, type LeverLink } from './types'

const HOST = /^jobs(\.eu)?\.lever\.co$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function parseLeverLink(raw: string): LeverLink | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  if (!HOST.test(host)) return null
  const [org, jobId, rest, ...more] = url.pathname.split('/').filter(Boolean)
  if (!org || !ORG.test(org) || !jobId || !UUID.test(jobId) || more.length || (rest && rest !== 'apply')) return null
  return { kind: 'hosted', org, jobId: jobId.toLowerCase(), formUrl: `https://${host}/${org}/${jobId.toLowerCase()}/apply` }
}

const SIGNATURE = /^eeo\[disabilitySignature\]$/
const SIGNATURE_DATE = /^eeo\[disabilitySignatureDate\]$/

/**
 * The disability form (CC-305) asks for a name and date, required only when a
 * disability answer is given. They are signed only alongside a saved disability
 * answer, never on their own.
 */
export function planLever(fields: FieldDescriptor[], p: Profile, now: Date = new Date()): FillPlan {
  const signature = fields.filter((f) => SIGNATURE.test(f.name) || SIGNATURE_DATE.test(f.name))
  const plan = planFill(
    fields.filter((f) => !signature.includes(f)),
    p,
    now,
  )
  const name = [p.legalFirstName.trim(), p.legalLastName.trim()].filter(Boolean).join(' ')
  if (!p.demographics.disability.trim() || !p.legalFirstName.trim() || !p.legalLastName.trim()) return plan
  const mmddyyyy = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`
  for (const f of signature) {
    if (f.hasValue) continue
    const date = SIGNATURE_DATE.test(f.name)
    plan.actions.push({ key: f.key, label: date ? 'Disability form date' : 'Disability form name', kind: f.kind, what: date ? 'today' : 'fullName', multi: false, value: date ? mmddyyyy : name })
  }
  return plan
}

/** In-page hooks for Lever forms. Self-contained: serialized into the page. */
export function leverDialect(win: any): any {
  const doc = win.document
  const isLocation = (el: any) => !!el.matches?.('input.location-input')
  const field = (el: any) => el.closest('.application-field') ?? el.parentElement
  const shown = (el: any) => !!el && win.getComputedStyle(el).display !== 'none'

  /** The question text: `.application-label` (custom questions keep it in `.text`), with the ✱ marker. */
  function question(el: any): string | null {
    const q = el.closest('.application-question')
    const l = q?.querySelector('.application-label')
    if (!l) return null
    return (l.querySelector('.text') ?? l).textContent
  }

  return {
    formReady: () => !!doc.querySelector('#application-form input[name="name"], #application-form input[name="email"]'),
    label: question,
    groupLabel: question,
    required: (el: any) => (el.closest('.application-field.required-field') ? true : null),
    kind: (el: any) => (isLocation(el) ? 'combobox' : null),
    comboValue: (el: any) => (isLocation(el) ? String(el.value ?? '') : null),
    options: (el: any) => (isLocation(el) ? Array.from(field(el).querySelectorAll('.dropdown-results .dropdown-location')) : null),
    menuState: (el: any) => {
      if (!isLocation(el)) return null
      const box = field(el)
      return { open: shown(box.querySelector('.dropdown-container')), loading: shown(box.querySelector('.dropdown-loading-results')) }
    },
    /** Lever chooses a location on mousedown. */
    pick: (el: any, o: any) => {
      if (!isLocation(el)) return null
      o.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      return true
    },
    /** Lever searches on keydown, which inserted text doesn't send. A key with no meaning starts the search. */
    afterType: (el: any) => {
      if (isLocation(el)) el.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true }))
    },
    resumeInput: () => doc.querySelector('#resume-upload-input, input[type="file"][name="resume"]'),
    outline: (e: any) => (Array.isArray(e) ? e[0]?.closest('.application-question') : (e.closest?.('.application-question') ?? null)),
  }
}

export const lever: BoardAdapter = {
  board: 'lever',
  name: 'Lever',
  parse(url) {
    const link = parseLeverLink(url)
    return link ? { board: 'lever', link } : null
  },
  isFormUrl: (url) => onHost(url, HOST),
  dialect: leverDialect,
  hydrationProbe: null,
  plan: planLever,
}
