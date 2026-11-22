/** Small fetch wrapper for public job boards and posting pages: timeouts, a plain User-Agent, readable errors. */

export const USER_AGENT = 'InternshipTracker/0.1 (desktop app)'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message?: string,
  ) {
    super(message ?? `${hostOf(url)} answered ${status}.`)
  }
}

export interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
  accept?: string
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** GET a URL. Throws HttpError for non-2xx answers and a plain Error for timeouts and network failures. */
export async function get(url: string, opts: RequestOptions = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15_000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  let res: Response
  try {
    res = await fetch(url, {
      signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: opts.accept ?? '*/*', 'Accept-Language': 'en-US,en;q=0.8' },
    })
  } catch (err) {
    if (opts.signal?.aborted) throw new CancelledError()
    if (timeout.aborted) throw new Error(`${hostOf(url)} took too long to answer.`)
    throw new Error(`Couldn't reach ${hostOf(url)}.`)
  }
  if (!res.ok) throw new HttpError(res.status, url)
  return res
}

export async function getJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await get(url, { accept: 'application/json', ...opts })
  try {
    return (await res.json()) as T
  } catch {
    throw new Error(`${hostOf(url)} sent something that isn't JSON.`)
  }
}

export async function getText(url: string, opts: RequestOptions = {}): Promise<{ text: string; url: string; type: string }> {
  const res = await get(url, { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', ...opts })
  const text = await res.text()
  return { text: text.length > 3_000_000 ? text.slice(0, 3_000_000) : text, url: res.url || url, type: res.headers.get('content-type') ?? '' }
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled.')
  }
}

/** Runs fn over items with at most `limit` in flight. Results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
