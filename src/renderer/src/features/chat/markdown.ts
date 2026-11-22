import { createElement as h, Fragment, type ReactNode } from 'react'

/*
 * A deliberately small Markdown subset for assistant replies: paragraphs, bold,
 * italics, inline code, fenced code blocks, bulleted and numbered lists (nested
 * by indentation) and links. Everything becomes React elements with text
 * children, so model output is always escaped; there is no raw HTML path.
 * Headings and quotes are shown as bold / plain paragraphs.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; c: Inline[] }
  | { t: 'pre'; lang: string; v: string }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] }

/** Only web links; anything else (javascript:, file:, data:) renders as plain text. */
export function safeHref(url: string): string | null {
  const u = url.trim()
  return /^https?:\/\/[^\s<>"']+$/i.test(u) ? u : null
}

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)|__(?=\S)([\s\S]*?\S)__|\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)|(?<![\w])_(?=\S)([\s\S]*?\S)_(?![\w])|\[([^\]\n]+)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)\s*\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  const text = (v: string) => {
    if (!v) return
    const parts = v.split('\n')
    parts.forEach((p, i) => {
      if (i) out.push({ t: 'br' })
      if (p) {
        const prev = out[out.length - 1]
        if (prev?.t === 'text') prev.v += p
        else out.push({ t: 'text', v: p })
      }
    })
  }
  let rest = src
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) {
      text(rest)
      break
    }
    text(rest.slice(0, m.index))
    const [whole, , code, b1, b2, i1, i2, label, href, bare] = m
    if (code !== undefined) out.push({ t: 'code', v: code.replace(/^ (.*) $/, '$1') })
    else if (b1 !== undefined || b2 !== undefined) out.push({ t: 'strong', c: parseInline((b1 ?? b2)!) })
    else if (i1 !== undefined || i2 !== undefined) out.push({ t: 'em', c: parseInline((i1 ?? i2)!) })
    else if (label !== undefined) {
      const safe = safeHref(href ?? '')
      if (safe) out.push({ t: 'link', href: safe, c: parseInline(label) })
      else text(label)
    } else if (bare !== undefined) out.push({ t: 'link', href: bare, c: [{ t: 'text', v: bare }] })
    else text(whole)
    rest = rest.slice(m.index + whole.length)
  }
  return out
}

const LIST_ITEM = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/

interface Line {
  indent: number
  marker: string
  text: string
}

function parseList(lines: Line[]): Block {
  const first = lines[0]!
  const ordered = /\d/.test(first.marker)
  const base = first.indent
  const items: Block[][] = []
  let i = 0
  while (i < lines.length) {
    const item = lines[i]!
    const body: string[] = [item.text]
    const children: Line[] = []
    i++
    while (i < lines.length && lines[i]!.indent > base) {
      const l = lines[i]!
      if (l.marker) children.push(l)
      else if (children.length) children[children.length - 1]!.text += '\n' + l.text
      else body.push(l.text)
      i++
    }
    const blocks: Block[] = [{ t: 'p', c: parseInline(body.join('\n')) }]
    if (children.length) blocks.push(...groupLists(children))
    items.push(blocks)
  }
  return { t: 'list', ordered, start: ordered ? parseInt(first.marker, 10) || 1 : 1, items }
}

/** Splits consecutive list lines into separate lists when the marker type changes at the top level. */
function groupLists(lines: Line[]): Block[] {
  const out: Block[] = []
  const base = Math.min(...lines.map((l) => l.indent))
  let cur: Line[] = []
  const flush = () => {
    if (cur.length) out.push(parseList(cur))
    cur = []
  }
  for (const l of lines) {
    if (l.indent <= base && l.marker && cur.length && /\d/.test(l.marker) !== /\d/.test(cur[0]!.marker)) flush()
    cur.push(l.indent < base ? { ...l, indent: base } : l)
  }
  flush()
  return out
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let list: Line[] = []
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join('\n').trim()) })
    para = []
  }
  const flushList = () => {
    if (list.length) blocks.push(...groupLists(list))
    list = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = FENCE.exec(line)
    if (fence) {
      flushPara()
      flushList()
      const close = fence[1]!
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith(close)) body.push(lines[i++]!)
      blocks.push({ t: 'pre', lang: fence[2] ?? '', v: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      flushPara()
      // A blank line inside a list only ends it if the next line isn't another item or continuation.
      const next = lines.slice(i + 1).find((l) => l.trim())
      if (list.length && next && (LIST_ITEM.test(next) || /^\s{2,}/.test(next))) continue
      flushList()
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara()
      list.push({ indent: item[1]!.replace(/\t/g, '    ').length, marker: item[2]!, text: item[3]! })
      continue
    }
    if (list.length && /^\s+\S/.test(line)) {
      list.push({ indent: line.match(/^\s*/)![0].length, marker: '', text: line.trim() })
      continue
    }
    flushList()
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara()
      continue
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      flushPara()
      blocks.push({ t: 'h', c: parseInline(heading[1]!) })
      continue
    }
    para.push(line.replace(/^\s{0,3}>\s?/, ''))
  }
  flushPara()
  flushList()
  return blocks
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.v
      case 'br':
        return h('br', { key: i })
      case 'code':
        return h('code', { key: i }, n.v)
      case 'strong':
        return h('strong', { key: i }, ...renderInline(n.c))
      case 'em':
        return h('em', { key: i }, ...renderInline(n.c))
      case 'link':
        return h('a', { key: i, href: n.href, target: '_blank', rel: 'noreferrer noopener', title: n.href }, ...renderInline(n.c))
    }
  })
}

function renderBlocks(blocks: Block[], tight = false): ReactNode[] {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'p':
        return tight ? h(Fragment, { key: i }, ...renderInline(b.c)) : h('p', { key: i }, ...renderInline(b.c))
      case 'h':
        return h('p', { key: i, className: 'md-h' }, h('strong', null, ...renderInline(b.c)))
      case 'pre':
        return h('pre', { key: i }, h('code', { 'data-lang': b.lang || undefined }, b.v))
      case 'list':
        return h(
          b.ordered ? 'ol' : 'ul',
          { key: i, start: b.ordered && b.start !== 1 ? b.start : undefined },
          ...b.items.map((item, j) => h('li', { key: j }, ...renderBlocks(item, item.length === 1 || item[0]?.t === 'p'))),
        )
    }
  })
}

/** Markdown text to React elements. Never produces raw HTML. */
export function renderMarkdown(src: string): ReactNode {
  return h(Fragment, null, ...renderBlocks(parseMarkdown(src)))
}
