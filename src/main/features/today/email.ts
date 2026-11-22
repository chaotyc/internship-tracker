import { createHash } from 'node:crypto'
import PostalMime from 'postal-mime'

/** The parts of an email the hook uses. Everything stays on this machine unless it matches a role. */
export interface ParsedEmail {
  from: { name: string; address: string }
  replyTo: string
  subject: string
  /** ISO time, or '' when unknown. */
  date: string
  /** Plain-text body (HTML converted). */
  text: string
  /** Stable key for spotting the same email twice: Message-ID, else a hash of the content. */
  key: string
}

const MAX_RAW = 2_000_000

/** Looks like an RFC 822 message: header lines first, including From or Subject, then a blank line. */
export function looksLikeRfc822(raw: string): boolean {
  const head = raw.replace(/^﻿/, '').split(/\r?\n\r?\n/, 1)[0] ?? ''
  const lines = head.split(/\r?\n/)
  if (lines.length < 2 || !/^[\w-]+:/.test(lines[0] ?? '')) return false
  const valid = lines.every((l) => /^[\w-]+:/.test(l) || /^[ \t]/.test(l))
  return valid && /^(from|subject):/im.test(head)
}

/** Parses a raw .eml (or IMAP source) or text the user copied out of a mail app. */
export async function parseEmail(input: string | Uint8Array): Promise<ParsedEmail> {
  if (typeof input === 'string' && input.length > MAX_RAW) input = input.slice(0, MAX_RAW)
  const asText = typeof input === 'string' ? input : null
  if (asText != null && !looksLikeRfc822(asText)) return parsePasted(asText)
  const mail = await PostalMime.parse(input instanceof Uint8Array ? input.slice(0, MAX_RAW) : input)
  const from = mail.from && 'address' in mail.from ? { name: mail.from.name ?? '', address: (mail.from.address ?? '').toLowerCase() } : { name: '', address: '' }
  const replyTo = mail.replyTo?.find((a) => 'address' in a && a.address)
  const text = (mail.text && mail.text.trim()) || (mail.html ? htmlToText(mail.html) : '')
  const date = mail.date && !Number.isNaN(Date.parse(mail.date)) ? new Date(mail.date).toISOString() : ''
  const subject = (mail.subject ?? '').trim()
  return {
    from,
    replyTo: replyTo && 'address' in replyTo ? (replyTo.address ?? '').toLowerCase() : '',
    subject,
    date,
    text: text.trim(),
    key: mail.messageId ? `msg:${mail.messageId.trim().toLowerCase()}` : `hash:${hash(from.address + '\n' + subject + '\n' + text)}`,
  }
}

const ADDRESS = /<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i

/**
 * Text copied out of a mail app has no headers, but usually starts with the subject, then
 * the sender ("Vectorline Recruiting <jobs@vectorline.com>"), then the date. Labelled lines
 * ("From:", "Subject:") from a forwarded message win when present.
 */
export function parsePasted(raw: string): ParsedEmail {
  const text = raw.replace(/\r\n?/g, '\n').trim()
  const lines = text.split('\n')
  const top = lines.slice(0, 15)
  const label = (name: string) => {
    const l = top.find((x) => new RegExp(`^\\s*${name}\\s*:`, 'i').test(x))
    return l ? l.replace(new RegExp(`^\\s*${name}\\s*:\\s*`, 'i'), '').trim() : ''
  }
  let fromLine = label('from')
  if (!fromLine) fromLine = top.find((l) => ADDRESS.test(l)) ?? ''
  const m = ADDRESS.exec(fromLine)
  const address = m ? m[1]!.toLowerCase() : ''
  const name = m ? fromLine.slice(0, m.index).replace(/^\s*from\s*:\s*/i, '').replace(/["']/g, '').trim() : fromLine.replace(/["']/g, '').trim()
  let subject = label('subject')
  if (!subject) {
    const first = lines.find((l) => l.trim())?.trim() ?? ''
    if (first.length <= 160 && !ADDRESS.test(first)) subject = first
  }
  const dateLine = label('date') || label('sent')
  const date = dateLine && !Number.isNaN(Date.parse(dateLine)) ? new Date(dateLine).toISOString() : ''
  return { from: { name, address }, replyTo: '', subject, date, text, key: `hash:${hash(text.replace(/\s+/g, ' ').toLowerCase())}` }
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|table|section)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*|#39);/gi, (m, e: string) => {
      if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16))
      if (e.startsWith('#') && e !== '#39') return String.fromCodePoint(parseInt(e.slice(1), 10))
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The body as sent to the AI: quoted earlier messages, long links and extra blank
 * lines removed, capped in size.
 */
export function trimBody(text: string, max = 4000): string {
  let t = text.replace(/\r\n?/g, '\n')
  const cut = t.search(/^(On .{0,200}wrote:|-{2,} ?Original Message ?-{2,}|_{10,}|From: .+\n(Sent|Date): )/im)
  if (cut > 0) t = t.slice(0, cut)
  t = t
    .split('\n')
    .filter((l) => !l.startsWith('>'))
    .join('\n')
    .replace(/https?:\/\/([^\s/>)\]]+)[^\s>)\]]*/gi, (_m, host: string) => `[link: ${host}]`)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at >= 0 ? address.slice(at + 1).toLowerCase().replace(/\.$/, '') : ''
}

export function formatFrom(from: ParsedEmail['from']): string {
  if (from.name && from.address) return `${from.name} <${from.address}>`
  return from.name || from.address || 'Unknown sender'
}
