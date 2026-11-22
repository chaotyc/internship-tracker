import { FITS, type Fit, type RoleInput, type StageKey } from '@shared/roles'

/** RFC 4180-style CSV parser: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const HEADERS: Record<string, keyof RoleInput | 'status'> = {
  company: 'company',
  role: 'title',
  title: 'title',
  position: 'title',
  'job title': 'title',
  stage: 'status',
  status: 'status',
  'my status': 'status',
  link: 'link',
  url: 'link',
  location: 'location',
  pay: 'pay',
  salary: 'pay',
  deadline: 'deadline',
  'job fit': 'fit',
  fit: 'fit',
  priority: 'priority',
  'why it fits': 'why',
  'watch-outs': 'watch',
  'watch outs': 'watch',
  notes: 'notes',
  'posting status': 'postingStatus',
}

export function stageFromStatus(status: string): StageKey {
  const s = status.toLowerCase()
  if (/offer/.test(s)) return 'offer'
  if (/reject|declin|turned down/.test(s)) return 'rejected'
  if (/interview|screen|loop|onsite|take-home/.test(s)) return 'interviewing'
  if (/^applied|submitted/.test(s)) return 'applied'
  if (/closed|^skipped$|no longer/.test(s)) return 'closed'
  return 'saved'
}

/** Finds the header row (it may sit below title rows) and maps each data row to a role. */
export function rolesFromCsv(text: string): RoleInput[] {
  const rows = parseCsv(text)
  const headerIdx = rows.findIndex((r) => {
    const keys = r.map((c) => HEADERS[c.trim().toLowerCase()])
    return keys.includes('company') && keys.includes('title')
  })
  if (headerIdx < 0) throw new Error('No header row with "Company" and "Role" (or "Title") columns was found.')
  const header = rows[headerIdx]!.map((c) => HEADERS[c.trim().toLowerCase()])
  const out: RoleInput[] = []
  for (const r of rows.slice(headerIdx + 1)) {
    const rec: Record<string, string> = {}
    header.forEach((key, i) => {
      if (key && r[i] != null && rec[key] == null) rec[key] = r[i]!.trim()
    })
    if (!rec['company'] || !rec['title']) continue
    const clean = (v?: string) => (v && v !== '—' ? v : '')
    const fit = clean(rec['fit']) as Fit
    const link = clean(rec['link'])
    out.push({
      company: rec['company'],
      title: rec['title'],
      stage: stageFromStatus(rec['status'] ?? ''),
      link: /^https?:\/\//.test(link) ? link : '',
      location: clean(rec['location']),
      pay: clean(rec['pay']),
      fit: FITS.includes(fit) ? fit : '',
      priority: clean(rec['priority']),
      why: clean(rec['why']),
      watch: clean(rec['watch']),
      notes: clean(rec['notes']),
      postingStatus: clean(rec['postingStatus']),
      source: 'import',
    })
  }
  return out
}
