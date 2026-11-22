import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseInline, parseMarkdown, renderMarkdown, safeHref } from './markdown'

const html = (md: string) => renderToStaticMarkup(renderMarkdown(md))

describe('markdown renderer', () => {
  it('escapes HTML in every position', () => {
    const out = html('<img src=x onerror=alert(1)> **<b>bold</b>** `<script>` [<i>x</i>](https://a.example)\n\n```\n</pre><script>alert(1)</script>\n```\n\n- <svg onload=alert(1)>')
    expect(out).not.toMatch(/<(img|script|svg|b|i)[\s>]/)
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(out).toContain('<strong>&lt;b&gt;bold&lt;/b&gt;</strong>')
    expect(out).toContain('<code>&lt;script&gt;</code>')
    expect(out).toContain('&lt;/pre&gt;&lt;script&gt;')
  })

  it('only links to http(s) URLs', () => {
    expect(html('[click](javascript:alert(1))')).toBe('<p>click</p>')
    expect(html('[x](data:text/html,hi)')).toBe('<p>x</p>')
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHref('https://exa"mple.com')).toBeNull()
    expect(html('[Posting](https://jobs.example/1)')).toBe(
      '<p><a href="https://jobs.example/1" target="_blank" rel="noreferrer noopener" title="https://jobs.example/1">Posting</a></p>',
    )
    expect(html('See https://example.com/x.')).toContain('<a href="https://example.com/x"')
  })

  it('renders inline styles', () => {
    expect(html('**bold**, *it*, _it2_, `code`, snake_case_name')).toBe(
      '<p><strong>bold</strong>, <em>it</em>, <em>it2</em>, <code>code</code>, snake_case_name</p>',
    )
    expect(parseInline('**a *b***')).toEqual([{ t: 'strong', c: [{ t: 'text', v: 'a ' }, { t: 'em', c: [{ t: 'text', v: 'b' }] }] }])
    expect(html('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>')
  })

  it('renders paragraphs, line breaks, lists and code blocks', () => {
    expect(html('one\ntwo\n\nthree')).toBe('<p>one<br/>two</p><p>three</p>')
    expect(html('- a\n- b\n  - nested\n\n- c')).toBe('<ul><li>a</li><li>b<ul><li>nested</li></ul></li><li>c</li></ul>')
    expect(html('3. x\n4. y')).toBe('<ol start="3"><li>x</li><li>y</li></ol>')
    expect(html('```ts\nconst a = 1\n```')).toBe('<pre><code data-lang="ts">const a = 1</code></pre>')
    expect(html('## Title')).toBe('<p class="md-h"><strong>Title</strong></p>')
  })

  it('handles an unclosed code block while streaming', () => {
    expect(parseMarkdown('Text\n```\npartial')).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'Text' }] },
      { t: 'pre', lang: '', v: 'partial' },
    ])
  })
})
