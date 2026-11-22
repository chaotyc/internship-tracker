/** Test helper: a fetch stand-in that answers from fixtures by URL. No network. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { JobPosting } from '../boards'

export const fixture = (name: string): string => readFileSync(join(__dirname, name), 'utf8')

type Route = string | { status?: number; body?: string; type?: string } | (() => Response | Promise<Response>)

/** Routes keyed by URL prefix. Unknown URLs answer 404. Returns the mock so tests can inspect calls. */
export function mockFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = String(input)
    const match = Object.keys(routes)
      .filter((k) => url === k || url.startsWith(k))
      .sort((a, b) => b.length - a.length)[0]
    if (match == null) return new Response('Not found', { status: 404 })
    const r = routes[match]!
    if (typeof r === 'function') return r()
    if (typeof r === 'string') {
      const type = r.trimStart().startsWith('<') ? 'text/html; charset=utf-8' : 'application/json'
      return new Response(r, { status: 200, headers: { 'content-type': type } })
    }
    return new Response(r.body ?? '', { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'text/html' } })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

let n = 0
/** A normalized posting with sensible defaults. */
export function posting(p: Partial<JobPosting> = {}): JobPosting {
  n++
  return {
    board: 'greenhouse',
    id: String(n),
    company: 'Acme',
    title: 'Software Engineering Intern',
    location: 'San Francisco, CA',
    url: `https://job-boards.greenhouse.io/acme/jobs/${n}`,
    postedAt: '2026-11-10',
    compensation: '',
    description: '',
    department: '',
    deadline: '',
    ...p,
  }
}
