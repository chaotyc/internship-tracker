import type { AiMessage } from '@shared/ai'
import type { ChatMessage } from '@shared/chat'
import { answersForTrack, effectiveDegreeLevel, resumeForTrack, roleTypesOf, trackById, type ApplicationTrack, type Profile } from '@shared/profile'
import { STAGES, type Role } from '@shared/roles'

export const HISTORY_LIMIT = 30
const HISTORY_CHARS = 60_000
const RESUME_CHARS = 12_000
const BOARD_LIMIT = 80

const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label ?? k
export const shortId = (id: string) => id.slice(0, 8)
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** "Saturday, November 21, 2026" in the user's local time. */
export function todayLine(now = new Date()): string {
  const date = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${date} (${iso})`
}

const yesNo = (v: boolean | null) => (v == null ? 'not stated' : v ? 'yes' : 'no')

/**
 * The parts of the profile the assistant may see. Built field by field from an
 * allowlist: demographics, email and phone are never included.
 */
export function profileSection(p: Profile, track: ApplicationTrack = trackById(p, '')): string {
  const lines: string[] = []
  const name = [p.legalFirstName, p.legalLastName].filter(Boolean).join(' ')
  if (name) lines.push(`Name: ${name}${p.preferredName && p.preferredName !== p.legalFirstName ? ` (goes by ${p.preferredName})` : ''}`)
  else if (p.preferredName) lines.push(`Name: ${p.preferredName}`)
  const place = [p.city, p.region, p.country].filter(Boolean).join(', ')
  if (place) lines.push(`Based in: ${place}`)
  for (const e of p.education ?? []) {
    const parts = [e.degree && e.field ? `${e.degree} in ${e.field}` : e.degree || e.field, e.school].filter(Boolean)
    if (!parts.length) continue
    const dates = [e.startDate, e.endDate].filter(Boolean).join(' – ')
    lines.push(`Education: ${parts.join(', ')}${dates ? ` (${dates})` : ''}${e.gpa ? `, GPA ${e.gpa}` : ''}`)
  }
  const links = (
    [
      ['LinkedIn', p.linkedin],
      ['GitHub', p.github],
      ['Website', p.website],
      ['Google Scholar', p.scholar],
    ] as const
  ).filter(([, v]) => v)
  if (links.length) lines.push(`Links: ${links.map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  if (p.authorizedToWorkUS != null || p.needsSponsorship != null)
    lines.push(`Authorized to work in the US: ${yesNo(p.authorizedToWorkUS)}. Needs visa sponsorship: ${yesNo(p.needsSponsorship)}.`)

  const pr = p.preferences
  const prefs: string[] = []
  prefs.push(`- Role types (roleTypes): ${roleTypesOf(pr.roleTypes).join(', ')}`)
  const degree = effectiveDegreeLevel(p)
  prefs.push(`- Degree level (degreeLevel): ${pr.degreeLevel || `not set${degree ? `, so search uses ${degree} from their education` : ''}`}`)
  if (pr.targetRoles.length) prefs.push(`- Target roles: ${pr.targetRoles.join(', ')}`)
  if (pr.locations.length) prefs.push(`- Locations: ${pr.locations.join(', ')}`)
  prefs.push(`- Open to remote: ${pr.remoteOk ? 'yes' : 'no'}`)
  if (pr.term) prefs.push(`- Term: ${pr.term}`)
  if (pr.minPay) prefs.push(`- Minimum pay: ${pr.minPay}`)
  if (pr.keywords.length) prefs.push(`- Keywords: ${pr.keywords.join(', ')}`)
  if (pr.excludeKeywords.length) prefs.push(`- Avoid: ${pr.excludeKeywords.join(', ')}`)
  if (pr.notes) prefs.push(`- Notes: ${oneLine(pr.notes)}`)

  const out = [lines.length ? lines.join('\n') : 'The user has not filled in their profile yet.', '', 'What they are looking for (current preferences):', prefs.join('\n')]
  const answers = answersForTrack(p, track)
  if (answers.length) {
    out.push('', p.tracks.length > 1 ? `Saved application answers (for the "${oneLine(track.name)}" track; its own answers come first and replace the general ones):` : 'Saved application answers:')
    for (const a of answers.slice(0, 40)) out.push(`- Q: ${oneLine(a.question)}\n  A: ${clip(oneLine(a.answer), 600)}`)
  }
  return out.join('\n')
}

/**
 * The user's application tracks (a resume and focus per kind of role), and which
 * one is in use. Empty when they have at most one track.
 */
export function tracksSection(p: Profile, active: ApplicationTrack): string {
  if (p.tracks.length < 2) return ''
  const lines = p.tracks.map((t, i) => {
    const bits = [t.description && oneLine(t.description), t.targetRoles.length && `targets ${t.targetRoles.join(', ')}`, t.keywords.length && `keywords ${t.keywords.join(', ')}`]
    const tags = [i === 0 && 'default', t.id === active.id && 'in use below', !t.resume && 'no resume yet'].filter(Boolean).join(', ')
    return `- ${oneLine(t.name)}${tags ? ` (${tags})` : ''}${bits.some(Boolean) ? `: ${bits.filter(Boolean).join('; ')}` : ''}`
  })
  return `The user keeps a separate resume and focus for each kind of role (application tracks). Each role on the board uses one; roles without one use the default.\n${lines.join('\n')}`
}

/** The resume text to use: the given track's, else the profile's (the default track's). */
export function resumeSection(p: Profile, track: ApplicationTrack = trackById(p, '')): string {
  const resume = resumeForTrack(p, track.id)
  const text = resume?.text?.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() ?? ''
  if (!text) return 'No resume on file. If the user asks for anything that depends on it, ask them to add their resume (there is an "Add your resume" button in this sidebar).'
  const from = p.tracks.length > 1 ? `(From the "${oneLine(track.name)}" track${track.resume ? `: ${resume!.fileName}` : `, which has no resume of its own, so this is the default track's: ${resume!.fileName}`}.)\n` : ''
  return from + clip(text, RESUME_CHARS - from.length)
}

const STAGE_ORDER = new Map(STAGES.map((s, i) => [s.key as string, i]))

/** One line per role, most active stages first, capped. */
export function boardSection(roles: Role[]): string {
  if (!roles.length) return 'The board is empty.'
  const sorted = [...roles].sort((a, b) => (STAGE_ORDER.get(a.stage) ?? 9) - (STAGE_ORDER.get(b.stage) ?? 9) || a.order - b.order)
  const lines = sorted.slice(0, BOARD_LIMIT).map((r) => {
    const bits = [stageLabel(r.stage)]
    if (r.fit) bits.push(`fit ${r.fit}`)
    if (r.deadline) bits.push(`deadline ${r.deadline}`)
    if (r.appliedOn && r.stage !== 'saved') bits.push(`applied ${r.appliedOn}`)
    if (r.liveness?.status === 'closed' || r.liveness?.status === 'expiring') bits.push(`posting ${r.liveness.status}`)
    return `- [${shortId(r.id)}] ${clip(oneLine(r.company), 60)} — ${clip(oneLine(r.title), 90)} | ${bits.join(' | ')}`
  })
  if (sorted.length > BOARD_LIMIT) lines.push(`- …and ${sorted.length - BOARD_LIMIT} more not shown`)
  return lines.join('\n')
}

export function openRoleSection(r: Role, track?: ApplicationTrack): string {
  const rows: [string, string][] = [
    ['Id', shortId(r.id)],
    ['Company', r.company],
    ['Title', r.title],
    ['Stage', stageLabel(r.stage)],
    ['Link', r.link],
    ['Location', r.location],
    ['Pay', r.pay],
    ['Deadline', r.deadline],
    ['Fit', r.fit],
    ['Priority', r.priority],
    ['Applied on', r.appliedOn],
    ['Why it fits', r.why],
    ['Watch out for', r.watch],
    ['Posting status', r.postingStatus || (r.liveness?.status !== 'unknown' ? `${r.liveness.status}. ${r.liveness.detail}` : '')],
    ['Notes', r.notes],
    ['Application track', track ? track.name : ''],
  ]
  return rows
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${clip(String(v).trim(), 2000)}`)
    .join('\n')
}

const ACTION_GUIDE = `## Proposing changes
You cannot change anything yourself. To propose a change, end your reply with one fenced block per change, exactly like this:

\`\`\`action
{"kind": "update_preferences", "preferences": {"targetRoles": ["ML inference intern"], "remoteOk": true}}
\`\`\`

The kinds (JSON only, double quotes, no comments):
- {"kind": "add_role", "role": {"company": "...", "title": "...", "link": "https://...", "location": "...", "pay": "...", "deadline": "YYYY-MM-DD", "fit": "Strong|Good|Moderate|Weak", "why": "one line on why it fits", "stage": "saved"}} — only company and title are required. Leave out anything you don't know; never invent links, pay or deadlines.
- {"kind": "update_preferences", "preferences": {...}} — fields: roleTypes (any of "internship", "newgrad", "fulltime"), degreeLevel ("bachelors", "masters", "phd", or "" to use their education), targetRoles (string[]), locations (string[]), remoteOk (boolean), term (string), minPay (string), keywords (string[]), excludeKeywords (string[]), notes (string). Only include fields that change. A list you include replaces the old list, so repeat the existing items the user wants to keep.
  How Find roles uses them: roleTypes, term, locations, excludeKeywords and degreeLevel are hard rules. It skips postings of other types, postings whose title names another term, postings in other places, postings whose title, department or requirements mention an excludeKeywords word, and postings limited to a higher degree than degreeLevel (for example PhD-only roles for an undergraduate). keywords and targetRoles decide what counts as relevant; it matches plurals and common synonyms (ML = machine learning). notes are soft guidance the AI reads when ranking. So "never show me X" belongs in excludeKeywords, "I'm an undergrad" in degreeLevel, and "full-time roles too" in roleTypes.
- {"kind": "save_answers", "answers": [{"question": "...", "answer": "..."}]} — reusable answers for the user's profile.
- {"kind": "move_role", "roleId": "<the 8-character id in brackets from the board>", "stage": "saved|applied|interviewing|offer|rejected|closed"}
- {"kind": "set_next_step", "roleId": "<the 8-character id>", "text": "short imperative, e.g. Finish the take-home", "due": "YYYY-MM-DD or empty", "time": "HH:MM (24h) or empty"} — the one dated thing to do next for a role; it replaces the role's current next step.

The user sees each block as a card with Apply and Dismiss buttons; nothing changes until they click Apply. Never say or imply a change is made, saved or in use ("I'll use this from now on", "I've added it") until the user has applied it; say what you're proposing and that it takes effect once they apply it. The blocks are hidden from the text, so in your prose say briefly what you're proposing ("I've suggested adding it to your board below."). Don't propose a change the user didn't ask for or clearly want, and don't propose adding a role that is already on the board.`

const JOBS = `## What you help with
1. **What they're looking for.** When the user describes what they want (roles, places, pay, term, remote, things to avoid), restate it in a sentence and propose an update_preferences action that merges it with their current preferences.
2. **Fit for a pasted job description.** Give a verdict first (Strong, Good, Moderate or Weak fit) in one line, then the specific reasons for and against, tied to concrete items on their resume and to their preferences (location, term, pay, work authorization). Flag deal-breakers like sponsorship, graduation date or clearance requirements. If it isn't on the board, offer an add_role action with what the posting actually says.
3. **Drafting application answers.** Write answers in the user's own voice: first person, plain and specific, drawn only from their resume, profile and saved answers. Never invent experience, numbers, awards or dates; if something is missing, write [bracketed placeholders] and say what you need. Respect any word or character limits. Present each answer under its question. For answers that will come up again (start date, how they heard about the company, why this field, availability), offer a save_answers action.
4. **Next steps on the board.** Use today's date to point out deadlines that are close, applications with no news for a while (suggest a short follow-up), interviews to prepare for and offers to decide on. Be concrete: which role, what to do, by when. Offer move_role only when the user tells you something changed.
5. **Finding roles that fit.** Suggest kinds of roles, teams and companies that match their resume and preferences, and explain why. Only propose add_role for a specific posting when you're confident it exists; otherwise suggest they use Autosearch or paste a link.`

export interface PromptInput {
  profile: Profile
  roles: Role[]
  openRole: Role | null
  now?: Date
}

export function buildSystemPrompt({ profile, roles, openRole, now = new Date() }: PromptInput): string {
  // The open role's track decides which resume and answers the assistant works from.
  const track = trackById(profile, openRole?.trackId)
  const tracks = tracksSection(profile, track)
  const parts = [
    `You are the assistant inside Internship Tracker, a desktop app where a student tracks internship and job applications on a board with the stages Saved, Applied, Interviewing, Offer, Rejected and Closed.`,
    `Today is ${todayLine(now)}.`,
    `## How to write
Be warm, direct and brief. Lead with the answer. Use short paragraphs and bullet lists; bold only the few words that matter. Use Markdown (bold, italics, lists, links, code), but no headings or tables. Refer to roles by company and title, never by their bracketed id. You can't browse, submit applications or contact anyone, and you never submit an application for the user.`,
    JOBS,
    ACTION_GUIDE,
    `## The user\n${profileSection(profile, track)}`,
    ...(tracks ? [`## Application tracks\n${tracks}`] : []),
    `## Resume (text)\n${resumeSection(profile, track)}`,
    `## Board (${roles.length} role${roles.length === 1 ? '' : 's'})\n${boardSection(roles)}`,
  ]
  if (openRole)
    parts.push(
      `## The role the user has open right now\nWhen they say "this role" or "this job", they mean this one.\n${openRoleSection(openRole, profile.tracks.length > 1 ? track : undefined)}`,
    )
  return parts.join('\n\n')
}

/** A short note about proposed actions, so the model remembers what it suggested and what the user did. */
function actionNote(m: ChatMessage): string {
  if (!m.actions.length) return ''
  const items = m.actions.map(({ action, state }) => {
    const what =
      action.kind === 'add_role'
        ? `add ${action.role.company} · ${action.role.title}`
        : action.kind === 'move_role'
          ? `move ${shortId(action.roleId)} to ${action.stage}`
          : action.kind === 'save_answers'
            ? `save ${action.answers.length} answer(s)`
            : action.kind === 'set_next_step'
              ? `set next step for ${shortId(action.roleId)}: ${action.text}${action.due ? ` by ${action.due}` : ''}`
              : `update preferences (${Object.keys(action.preferences).join(', ')})`
    return `${what}: ${state}`
  })
  return `\n\n[Proposed changes — ${items.join('; ')}]`
}

/**
 * The conversation as the model sees it: the last HISTORY_LIMIT messages, also
 * capped by size, starting with a user turn, with same-speaker turns merged.
 */
export function historyForModel(messages: ChatMessage[], limit = HISTORY_LIMIT, maxChars = HISTORY_CHARS): AiMessage[] {
  const recent = messages.filter((m) => m.content.trim() || m.actions.length).slice(-limit)
  const out: AiMessage[] = []
  let used = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i]!
    const content = (m.content.trim() || '(no text)') + (m.role === 'assistant' ? actionNote(m) : '') + (m.stopped ? '\n\n[The user stopped this reply early.]' : '')
    if (used + content.length > maxChars && out.length) break
    used += content.length
    const first = out[0]
    if (first && first.role === m.role) first.content = `${content}\n\n${first.content}`
    else out.unshift({ role: m.role, content })
  }
  while (out.length && out[0]!.role !== 'user') out.shift()
  return out
}
