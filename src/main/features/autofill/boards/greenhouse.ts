import { planFill } from '../match'
import { parseGreenhouseLink } from '../url'
import { onHost, type BoardAdapter } from './types'

/** Greenhouse: the generic page behavior was built on its forms, so it needs no dialect. */
export const greenhouse: BoardAdapter = {
  board: 'greenhouse',
  name: 'Greenhouse',
  parse(url) {
    const link = parseGreenhouseLink(url)
    return link ? { board: 'greenhouse', link } : null
  },
  isFormUrl: (url) => onHost(url, /^(job-boards|boards)(\.eu)?\.greenhouse\.io$/),
  dialect: null,
  // Server-rendered, then React takes over; values set before that are thrown away.
  hydrationProbe: `(() => { const el = document.querySelector('#first_name, form input'); return !!el && Object.keys(el).some((k) => k.startsWith('__react')) })()`,
  plan: planFill,
}
