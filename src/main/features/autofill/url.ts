/**
 * Recognizes Greenhouse application links. Pure: no Electron, no network.
 *
 *   job-boards.greenhouse.io/<board>/jobs/<id>          hosted posting with the form below it
 *   boards.greenhouse.io/<board>/jobs/<id>              legacy host, redirects to job-boards
 *   job-boards.greenhouse.io/embed/job_app?for=&token=  the form alone (what company pages iframe)
 *   careers.example.com/jobs?gh_jid=<id>                company page embedding the Greenhouse iframe
 */
export type GreenhouseLink =
  | { kind: 'hosted'; board: string; jobId: string; formUrl: string }
  | { kind: 'embed'; board: string; jobId: string; formUrl: string }
  /** Company page: the board token is not in the URL, so it is resolved when the window opens. */
  | { kind: 'company'; board: string | null; jobId: string; pageUrl: string; boardGuesses: string[] }

const GH_HOST = /^(job-boards|boards)(\.eu)?\.greenhouse\.io$/i
const TOKEN = /^[A-Za-z0-9_-]+$/
const JOB_ID = /^\d{3,}$/

export function parseGreenhouseLink(raw: string): GreenhouseLink | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()

  if (GH_HOST.test(host)) {
    const eu = host.includes('.eu.')
    const formHost = `https://job-boards${eu ? '.eu' : ''}.greenhouse.io`
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'embed' && (parts[1] === 'job_app' || parts[1] === 'job_app.html')) {
      const board = url.searchParams.get('for') ?? ''
      const jobId = url.searchParams.get('token') ?? url.searchParams.get('gh_jid') ?? ''
      if (!TOKEN.test(board) || !JOB_ID.test(jobId)) return null
      return { kind: 'embed', board, jobId, formUrl: embedFormUrl(board, jobId, eu) }
    }
    // /<board>/jobs/<id>
    const [board, jobs, jobId] = parts
    if (board && jobs === 'jobs' && jobId && TOKEN.test(board) && JOB_ID.test(jobId)) {
      const formUrl = host.startsWith('job-boards') ? url.toString() : `${formHost}/${board}/jobs/${jobId}`
      return { kind: 'hosted', board, jobId, formUrl }
    }
    return null
  }

  // Company career page with an embedded Greenhouse board.
  const jobId = url.searchParams.get('gh_jid') ?? ''
  if (!JOB_ID.test(jobId)) return null
  const forParam = url.searchParams.get('for')
  const board = forParam && TOKEN.test(forParam) ? forParam : null
  return { kind: 'company', board, jobId, pageUrl: url.toString(), boardGuesses: board ? [board] : boardGuesses(host) }
}

export function embedFormUrl(board: string, jobId: string, eu = false): string {
  return `https://job-boards${eu ? '.eu' : ''}.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${encodeURIComponent(jobId)}`
}

const GENERIC_LABELS = new Set(['www', 'careers', 'career', 'jobs', 'job', 'apply', 'boards', 'join', 'work', 'about', 'en', 'us'])

/** "www.databricks.com" -> ["databricks"]; "careers.acme-robotics.co.uk" -> ["acme-robotics", "acmerobotics"]. */
export function boardGuesses(host: string): string[] {
  const labels = host.toLowerCase().split('.').filter(Boolean)
  // Drop the public suffix: the last label, plus a second-level one like "co" in co.uk.
  labels.pop()
  if (labels.length > 1 && /^(co|com|org|net|ac|gov)$/.test(labels[labels.length - 1]!)) labels.pop()
  const out: string[] = []
  for (const l of labels.reverse()) {
    if (GENERIC_LABELS.has(l)) continue
    for (const g of [l, l.replace(/-/g, '')]) if (g && TOKEN.test(g) && !out.includes(g)) out.push(g)
  }
  return out.slice(0, 4)
}

/**
 * Finds the board token in a company page's markup: the grnhse_iframe src, the
 * embed script (`job_board/js?for=`) or any link to the embed form.
 */
export function boardFromHtml(html: string): string | null {
  const m =
    /greenhouse\.io\/embed\/job_(?:app|board)(?:\/js)?\?[^"'\s>]*?\bfor=([A-Za-z0-9_-]+)/i.exec(html) ??
    /greenhouse\.io\/([A-Za-z0-9_-]+)\/jobs\/\d+/i.exec(html)
  const token = m?.[1]
  return token && token !== 'embed' ? token : null
}

export function isGreenhouseApplication(url: string): boolean {
  return parseGreenhouseLink(url) !== null
}
