/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Ashby (jobs.ashbyhq.com). The form is a React app without a <form> element:
 * text inputs, location and school autocompletes (role="combobox"), react-datepicker
 * date inputs, radio and checkbox groups in fieldsets, Yes/No button pairs, and an
 * "Autofill from resume" upload that autofill never touches.
 */
import { planFill } from '../match'
import { boardGuesses } from '../url'
import { onHost, type AshbyLink, type BoardAdapter } from './types'

const HOST = /^jobs\.ashbyhq\.com$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORG = /^[A-Za-z0-9][A-Za-z0-9._~%-]*$/
const NOT_ORGS = new Set(['api', 'embed', 'static', 'assets'])

export function parseAshbyLink(raw: string): AshbyLink | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const jid = url.searchParams.get('ashby_jid') ?? ''
  if (HOST.test(url.hostname.toLowerCase())) {
    const [org, second, third] = url.pathname.split('/').filter(Boolean)
    if (!org || !ORG.test(org) || NOT_ORGS.has(org.toLowerCase())) return null
    // /<org>/<id>, /<org>/<id>/application, or the board with ?ashby_jid=<id>
    const jobId = second && UUID.test(second) ? second : UUID.test(jid) && (!second || second === 'embed') ? jid : ''
    if (!jobId || (third && third !== 'application')) return null
    return { kind: 'hosted', org, jobId: jobId.toLowerCase(), formUrl: ashbyFormUrl(org, jobId) }
  }
  if (!UUID.test(jid)) return null
  return { kind: 'company', jobId: jid.toLowerCase(), pageUrl: url.toString(), orgGuesses: boardGuesses(url.hostname) }
}

export function ashbyFormUrl(org: string, jobId: string): string {
  return `https://jobs.ashbyhq.com/${org}/${jobId.toLowerCase()}/application`
}

/** The org from a company page's Ashby embed script or iframe ("jobs.ashbyhq.com/<org>/embed"). */
export function ashbyOrgFromHtml(html: string): string | null {
  for (const m of html.matchAll(/jobs\.ashbyhq\.com\/([A-Za-z0-9._~%-]+)/gi)) {
    const org = m[1]!
    if (ORG.test(org) && !NOT_ORGS.has(org.toLowerCase())) return org
  }
  return null
}

/** In-page hooks for Ashby forms. Self-contained: serialized into the page. */
export function ashbyDialect(win: any, h: any): any {
  const doc = win.document
  const TITLE = 'label.ashby-application-form-question-title'

  /** The question title for a control: its <label for>, else the nearest title up to its field entry. */
  function title(el: any): any {
    if (el.id) {
      const l = doc.querySelector(`label[for="${win.CSS.escape(el.id)}"]`)
      if (l && !l.contains(el)) return l
    }
    let p = el.parentElement
    for (let i = 0; i < 10 && p; i++, p = p.parentElement) {
      const l = Array.from(p.children).find((c: any) => c.matches(TITLE))
      if (l) return l
      if (p.matches('[data-field-path]')) break
    }
    return null
  }
  const isRequired = (l: any) => !!l && /(^|\s)_?required/.test(String(l.className))

  const entries = () => Array.from(doc.querySelectorAll('.ashby-application-form-input-education-entry')) as any[]

  /** Education-history subfields get Greenhouse-style ids ("school--0") so the shared matcher reads them. */
  function eduId(el: any): string | null {
    const entry = el.closest('.ashby-application-form-input-education-entry')
    if (!entry) return null
    const i = entries().indexOf(entry)
    if (el.getAttribute('role') === 'combobox') return `school--${i}`
    if (/-degree$/.test(el.id)) return `degree--${i}`
    if (/-major$/.test(el.id)) return `discipline--${i}`
    if (el.tagName === 'SELECT') {
      const box = el.closest('[id$="-startDate"], [id$="-endDate"]')
      if (!box) return null
      const which = /-startDate$/.test(box.id) ? 'start' : 'end'
      const part = /year/i.test(el.options[0]?.textContent ?? '') ? 'year' : 'month'
      return `${which}-${part}--${i}`
    }
    return null
  }

  const autocomplete = (el: any) => el.matches?.('input.ashby-application-form-input-autocomplete, input[role="combobox"]')

  return {
    formRoot: () => doc.querySelector('#form[role="tabpanel"]') ?? doc.querySelector('.ashby-application-form-container')?.parentElement ?? null,
    formReady: () => !!doc.querySelector('.ashby-application-form-container input, .ashby-application-form-container textarea'),
    skip(el: any): boolean {
      // The "Autofill from resume" upload would overwrite fields with whatever it parses.
      if (el.closest('.ashby-application-form-autofill-pane, .ashby-application-form-autofill-input-root')) return true
      // The hidden checkbox behind a Yes/No pair; the buttons are the control.
      if (el.closest('.ashby-application-form-input-yesno')) return true
      // Text-message and WhatsApp consent is the applicant's call.
      if (/consent/i.test(el.name || '')) return true
      return false
    },
    groups(root: any): any[] {
      const out: any[] = []
      for (const box of Array.from(root.querySelectorAll('.ashby-application-form-input-yesno')) as any[]) {
        const members = Array.from(box.querySelectorAll('button[data-option]'))
        const t = title(box)
        out.push({ members, kind: 'radio', label: t?.textContent ?? '', required: isRequired(t), id: box.closest('[data-field-path]')?.getAttribute('data-field-path') ?? '' })
      }
      for (const fs of Array.from(root.querySelectorAll('fieldset.ashby-application-form-input-checkbox-group, fieldset.ashby-application-form-input-radio-group')) as any[]) {
        const radio = fs.matches('.ashby-application-form-input-radio-group')
        const members = Array.from(fs.querySelectorAll(radio ? 'input[type="radio"]' : 'input[type="checkbox"]'))
        const t = fs.querySelector(TITLE)
        out.push({
          members,
          kind: radio ? 'radio' : 'checkboxes',
          label: t?.textContent ?? '',
          required: isRequired(t),
          id: fs.closest('[data-field-path]')?.getAttribute('data-field-path') ?? '',
        })
      }
      return out
    },
    label(el: any): string | null {
      if (el.tagName === 'SELECT') {
        const id = eduId(el)
        const m = id && /^(start|end)-(month|year)/.exec(id)
        if (m) return `${m[1] === 'start' ? 'Start' : 'End'} date ${m[2]}`
      }
      const t = title(el)
      return t ? t.textContent : null
    },
    required(el: any): boolean | null {
      return isRequired(title(el)) || null
    },
    kind: (el: any) => (el.matches('input.ashby-application-form-input-date') ? 'date' : null),
    id: (el: any) => eduId(el),
    comboValue: (el: any) => (autocomplete(el) ? String(el.value ?? '') : null),
    /** School options read "Stanford University · United States · stanford.edu"; the first span is the name. */
    optionText: (o: any) => {
      const span = o.querySelector('span')
      return span ? h.clean(span.textContent) : null
    },
    resumeInput: () => doc.querySelector('[data-field-path="_systemfield_resume"] input[type="file"], #_systemfield_resume'),
    outline: (e: any) => (Array.isArray(e) ? e[0]?.closest('[data-field-path]') : (e.closest?.('[data-field-path]') ?? null)),
  }
}

export const ashby: BoardAdapter = {
  board: 'ashby',
  name: 'Ashby',
  parse(url) {
    const link = parseAshbyLink(url)
    return link ? { board: 'ashby', link } : null
  },
  isFormUrl: (url) => onHost(url, HOST),
  dialect: ashbyDialect,
  // Client-rendered: wait for React to own the first input.
  hydrationProbe: `(() => { const el = document.querySelector('.ashby-application-form-container input'); return !!el && Object.keys(el).some((k) => k.startsWith('__react')) })()`,
  plan: planFill,
}
