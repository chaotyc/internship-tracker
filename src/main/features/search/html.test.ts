import { describe, expect, it } from 'vitest'
import { closedPhrase, decodeEntities, extractJsonLdJob, formatPay, htmlToText, isoDay, metaContent, pageTitle, payFromText } from './html'
import { fixture } from './fixtures/mockFetch'

describe('htmlToText', () => {
  it('drops scripts, styles and tags but keeps the words and list items', () => {
    const text = htmlToText(fixture('posting-jsonld.html'))
    expect(text).toContain('Optical Test Intern')
    expect(text).toContain('Join our lab in Tucson')
    expect(text).toContain('• Build test fixtures')
    expect(text).toContain('Home & About')
    expect(text).not.toMatch(/analytics|\.hero|<|ld\+json|Careers \| Acme/)
  })

  it('caps the length', () => {
    const t = htmlToText(`<p>${'word '.repeat(10_000)}</p>`, 20_000)
    expect(t.length).toBeLessThanOrEqual(20_001)
    expect(t.endsWith('…')).toBe(true)
  })

  it('decodes named and numeric entities', () => {
    expect(decodeEntities('R&amp;D &#8211; &#x2014; &rsquo;s &nbsp;x &bogus;')).toBe('R&D – — ’s  x &bogus;')
  })
})

describe('meta and JSON-LD', () => {
  const html = fixture('posting-jsonld.html')

  it('reads og:title, site name and title', () => {
    expect(metaContent(html, 'og:title')).toBe('Optical Test Intern at Acme Optics')
    expect(metaContent(html, 'og:site_name')).toBe('Acme Optics')
    expect(pageTitle(html)).toBe('Careers | Acme Optics')
  })

  it('extracts a JobPosting from a @graph', () => {
    expect(extractJsonLdJob(html)).toEqual({
      title: 'Optical Test Intern',
      company: 'Acme Optics',
      location: 'Tucson, AZ',
      deadline: '2027-01-31',
      pay: '$30–38/hr',
      postedAt: '2026-11-01',
      description: 'Test lasers and fiber assemblies.',
    })
  })

  it('handles arrays, remote jobs, plain-string organizations and pages without JSON-LD', () => {
    const page = `<script type="application/ld+json">[{"@type":"WebSite"},{"@type":["JobPosting"],"title":"Intern","hiringOrganization":"Acme","jobLocationType":"TELECOMMUTE","baseSalary":{"currency":"USD","value":{"value":9000,"unitText":"MONTH"}}}]</script>`
    expect(extractJsonLdJob(page)).toMatchObject({ title: 'Intern', company: 'Acme', location: 'Remote', pay: '$9k/mo', deadline: '' })
    expect(extractJsonLdJob('<p>hi</p>')).toBeNull()
    expect(extractJsonLdJob('<script type="application/ld+json">{not json</script>')).toBeNull()
  })

  it('only turns real dates into deadlines', () => {
    expect(isoDay('2027-03-01T00:00:00Z')).toBe('2027-03-01')
    expect(isoDay('soon')).toBe('')
    expect(isoDay('')).toBe('')
  })
})

describe('pay', () => {
  it('formats ranges like the board', () => {
    expect(formatPay(207000, 285000, 'USD', '1 YEAR')).toBe('$207k–285k/yr')
    expect(formatPay(45, 45, 'USD', 'per-hour-wage')).toBe('$45/hr')
    expect(formatPay(7300, 12700, 'USD', 'month')).toBe('$7.3k–12.7k/mo')
    expect(formatPay(null, null)).toBe('')
    expect(formatPay(3000, null, 'EUR', 'month')).toBe('€3k/mo')
  })

  it('pulls a printed range out of text, exactly as printed', () => {
    expect(payFromText('The pay is $45 - $55 per hour plus housing.')).toBe('$45 - $55 per hour')
    expect(payFromText('Salary: $120,000 to $150,000 a year')).toBe('$120,000 to $150,000 a year')
    expect(payFromText('Competitive pay.')).toBe('')
  })
})

describe('closedPhrase', () => {
  it('spots pages that say the posting closed', () => {
    expect(closedPhrase(htmlToText(fixture('closed-page.html')))).toMatch(/no longer accepting applications/i)
    expect(closedPhrase('This job is no longer available.')).not.toBe('')
    expect(closedPhrase('The position has been filled.')).not.toBe('')
    expect(closedPhrase(htmlToText(fixture('posting-jsonld.html')))).toBe('')
  })
})
