/** Reading posting pages without a DOM: readable text, meta tags and JSON-LD JobPosting. */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  middot: '·',
  trade: '™',
  reg: '®',
  copy: '©',
  euro: '€',
  pound: '£',
  times: '×',
  shy: '',
  zwj: '',
  zwnj: '',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return NAMED[e.toLowerCase()] ?? m
  })
}

const BLOCK = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|blockquote|pre|hr|dd|dt)\b[^>]*>/gi

/** Visible text of an HTML fragment or page, with paragraph breaks kept. */
export function htmlToText(html: string, max = 20_000): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(BLOCK, '\n')
    .replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s
}

/** Greenhouse sends its job HTML entity-escaped; this decodes then strips it. */
export function escapedHtmlToText(html: string, max = 20_000): string {
  return htmlToText(decodeEntities(html), max)
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null
}

/** Value of a <meta property|name="key" content="..."> tag. */
export function metaContent(html: string, key: string): string {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0]
    const k = attr(tag, 'property') ?? attr(tag, 'name')
    if (k && k.toLowerCase() === key.toLowerCase()) return (attr(tag, 'content') ?? '').trim()
  }
  return ''
}

export function pageTitle(html: string): string {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return m ? decodeEntities(m[1]!).replace(/\s+/g, ' ').trim() : ''
}

export interface JsonLdJob {
  title: string
  company: string
  location: string
  /** YYYY-MM-DD from validThrough, or ''. */
  deadline: string
  pay: string
  postedAt: string
  description: string
}

/** Every JSON-LD object on the page, flattened out of arrays and @graph. */
export function jsonLdObjects(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      out.push(v as Record<string, unknown>)
      const g = (v as Record<string, unknown>)['@graph']
      if (g) walk(g)
    }
  }
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1]!.trim().replace(/^<!\[CDATA\[|\]\]>$/g, '')
    try {
      walk(JSON.parse(raw))
    } catch {
      try {
        // Some sites put raw newlines inside strings.
        walk(JSON.parse(raw.replace(/[\r\n\t]+/g, ' ')))
      } catch {
        /* not JSON; skip */
      }
    }
  }
  return out
}

const isType = (o: Record<string, unknown>, t: string) => {
  const ty = o['@type']
  return Array.isArray(ty) ? ty.includes(t) : ty === t
}

const str = (v: unknown): string => (typeof v === 'string' ? decodeEntities(v).trim() : typeof v === 'number' ? String(v) : '')

function nameOf(v: unknown): string {
  if (typeof v === 'string') return str(v)
  if (v && typeof v === 'object') return str((v as Record<string, unknown>)['name'])
  return ''
}

function placeOf(v: unknown): string {
  const one = (p: unknown): string => {
    if (!p || typeof p !== 'object') return str(p)
    const o = p as Record<string, unknown>
    const a = o['address']
    if (a && typeof a === 'object') {
      const ad = a as Record<string, unknown>
      const country = nameOf(ad['addressCountry'])
      const parts = [str(ad['addressLocality']), str(ad['addressRegion'])].filter(Boolean)
      if (!parts.length && country) parts.push(country)
      else if (country && !/^(US|USA|United States)$/i.test(country)) parts.push(country)
      return parts.join(', ')
    }
    return str(a) || nameOf(o)
  }
  const list = (Array.isArray(v) ? v : [v]).map(one).filter(Boolean)
  return [...new Set(list)].join('; ')
}

/** "2027-01-15T00:00:00Z" → "2027-01-15". Only when the value is a real date. */
export function isoDay(v: unknown): string {
  const s = str(v)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  if (!s) return ''
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', JPY: '¥', INR: '₹' }

function amount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1).replace(/\.0$/, '')}k`
  }
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/** Formats a pay range the way the board shows them: "$40–50/hr", "$207k–285k/yr". */
export function formatPay(min: number | null | undefined, max: number | null | undefined, currency = 'USD', interval = ''): string {
  const lo = typeof min === 'number' && min > 0 ? min : null
  const hi = typeof max === 'number' && max > 0 ? max : null
  if (lo == null && hi == null) return ''
  const sym = SYMBOL[currency.toUpperCase()] ?? `${currency.toUpperCase()} `
  const i = interval.toLowerCase()
  const unit = /hour/.test(i) ? '/hr' : /week/.test(i) ? '/wk' : /month/.test(i) ? '/mo' : /year|annual|salary/.test(i) ? '/yr' : ''
  const range = lo != null && hi != null && lo !== hi ? `${amount(lo)}–${amount(hi)}` : amount((lo ?? hi)!)
  return `${sym}${range}${unit}`
}

function salaryOf(v: unknown): string {
  if (!v || typeof v !== 'object') return str(v)
  const o = v as Record<string, unknown>
  const cur = str(o['currency']) || 'USD'
  const val = o['value']
  if (val && typeof val === 'object') {
    const q = val as Record<string, unknown>
    const num = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : null)
    return formatPay(num(q['minValue']) ?? num(q['value']), num(q['maxValue']), cur, str(q['unitText']))
  }
  if (typeof val === 'number') return formatPay(val, null, cur, str(o['unitText']))
  return ''
}

/** The first JobPosting in the page's JSON-LD, normalized. */
export function extractJsonLdJob(html: string): JsonLdJob | null {
  const job = jsonLdObjects(html).find((o) => isType(o, 'JobPosting'))
  if (!job) return null
  let location = placeOf(job['jobLocation'])
  const remote = str(job['jobLocationType']).toUpperCase() === 'TELECOMMUTE'
  if (remote) location = location ? `${location} or remote` : 'Remote'
  const desc = str(job['description'])
  return {
    title: str(job['title']),
    company: nameOf(job['hiringOrganization']),
    location,
    deadline: isoDay(job['validThrough']),
    pay: salaryOf(job['baseSalary']),
    postedAt: isoDay(job['datePosted']),
    description: desc ? htmlToText(desc, 8000) : '',
  }
}

const PAY_RE =
  /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?(?:\s?(?:USD))?\s?(?:-|–|—|to)\s?(?:US)?\$?\s?\d[\d,]*(?:\.\d+)?\s?[kK]?(?:\s?USD)?(?:\s?(?:\/|per|an|a)\s?(?:hour|hr|year|yr|annum|month|mo|week|wk))?/

/** A pay range printed in the text ("$45 - $55 per hour"), exactly as printed, or ''. */
export function payFromText(text: string): string {
  const m = PAY_RE.exec(text)
  return m ? m[0].replace(/\s+/g, ' ').trim() : ''
}

/** Phrases job pages show once a posting stops taking applications. */
const CLOSED_PATTERNS = [
  /no longer (?:accepting|taking) applications/i,
  /(?:job|position|posting|role|opening|requisition) (?:is|has been) (?:closed|filled|removed)/i,
  /(?:job|position|posting|role|opening) (?:you(?:'|’)re|you are) looking for (?:is|has) (?:no longer|been)/i,
  /(?:this|the) (?:job|position|posting|role|opening) is no longer (?:available|open|active|posted)/i,
  /(?:job|position|posting) (?:has )?expired/i,
  /applications? (?:are |is )?(?:now )?closed/i,
]

/** The matching sentence when a page says the posting is closed, or ''. */
export function closedPhrase(text: string): string {
  for (const re of CLOSED_PATTERNS) {
    const m = re.exec(text)
    if (m) return m[0]
  }
  return ''
}
