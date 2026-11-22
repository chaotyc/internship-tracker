/** The part of a posting worth ranking on: its requirements, not the company's About Us. */

/** Headings that start the "what you need" part of a posting. */
const REQ_HEADING =
  /^(?:#+\s*)?(?:(?:minimum|basic|required|preferred|desired|key|additional|nice[- ]to[- ]have|bonus)\s+)?(?:qualifications?|requirements?|skills(?:\s+(?:and|&)\s+(?:experience|qualifications))?|experience)\b|^(?:#+\s*)?(?:what (?:you(?:'|’)ll|you will) (?:bring|need)|what (?:we(?:'|’)re|we are) looking for|who you are|about you|you (?:have|bring|might be a fit|should have)|you(?:'|’)ll (?:have|thrive)|ideal candidate|must[- ]haves?|we(?:'|’)d love (?:to see|if you)|your (?:background|profile|skills)|is this you)\b/i

/** Headings where the requirements stop and boilerplate starts. */
const STOP_HEADING =
  /^(?:#+\s*)?(?:benefits|perks|what we offer|compensation|pay (?:range|transparency)|salary|the (?:base )?pay|equal (?:employment )?opportunity|eeo\b|about (?:us|the company|[A-Z][\w&.-]*(?: [A-Z][\w&.-]*)?)\s*$|who we are|our (?:mission|values|culture)|life at|why join|accommodations?|privacy|how to apply|location and work model|#li-)/i

/** Headings for the role itself, used to skip a leading company blurb when there is no requirements heading. */
const ROLE_HEADING =
  /^(?:#+\s*)?(?:about (?:the|this) (?:role|position|job|team|internship|opportunity)|the (?:role|position|opportunity|team)|role (?:overview|description|summary)|job (?:description|summary|overview)|position (?:overview|summary)|what you(?:'|’)ll do|what you will do|responsibilities|your (?:role|impact)|in this role|the internship)\b/i

/** Leading paragraphs that are about the company, not the role. */
const BLURB =
  /^(?:[Aa]t [A-Z]|[Aa]bout [A-Z]|[Ww]ho we are|[Oo]ur (?:mission|company|team)|[Ww]e are (?:a|an|the)\b|[Ww]e(?:'|’)re |[Ff]ounded in|[Jj]oin (?:us|our|the)\b|[A-Z][\w&.-]*(?: [A-Z][\w&.-]*)? (?:is|builds|develops|designs|creates|makes) (?:a|an|the)\b)/

/** A short line with no sentence punctuation looks like a heading. */
const isHeadingLine = (line: string) => {
  const t = line.replace(/^[#*\s]+|[*:\s]+$/g, '')
  return t.length > 0 && t.length <= 70 && !/[.!?]$/.test(t) && !t.startsWith('•')
}

/**
 * About `max` characters of the posting's requirements: from the first Requirements / Qualifications /
 * What you'll bring heading (and the qualification headings after it) up to Benefits or EEO text.
 * With no such heading, the first `max` characters after the company blurb.
 */
export function requirementsExcerpt(description: string, max = 1500): string {
  const text = description.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
  if (!text) return ''
  const lines = text.split('\n')
  const clip = (s: string) => {
    const t = s.replace(/[ \t]*\n\s*/g, '\n').trim()
    return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t
  }

  const start = lines.findIndex((l) => isHeadingLine(l) && REQ_HEADING.test(l.trim().replace(/^[*•\s]+/, '')))
  if (start >= 0) {
    const out: string[] = []
    for (let i = start; i < lines.length; i++) {
      const l = lines[i]!
      if (i > start && isHeadingLine(l) && STOP_HEADING.test(l.trim())) break
      out.push(l)
    }
    const section = out.join('\n').trim()
    // A heading with almost nothing under it ("Requirements: see below") isn't the section.
    if (section.length >= 40) return clip(section)
  }

  // No requirements heading: start at the role heading if there is one, else skip leading company paragraphs.
  const role = lines.findIndex((l) => isHeadingLine(l) && ROLE_HEADING.test(l.trim()))
  let from = role >= 0 ? role : 0
  if (role < 0) {
    while (from < lines.length - 1 && (BLURB.test(lines[from]!.trim()) || !lines[from]!.trim() || STOP_HEADING.test(lines[from]!.trim()))) from++
  }
  const rest: string[] = []
  for (let i = from; i < lines.length; i++) {
    const l = lines[i]!
    if (i > from && isHeadingLine(l) && STOP_HEADING.test(l.trim())) break
    rest.push(l)
  }
  return clip(rest.join('\n').trim() || text)
}
