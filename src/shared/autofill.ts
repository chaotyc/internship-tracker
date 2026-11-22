/** Job boards autofill knows how to fill. */
export type AutofillBoard = 'greenhouse' | 'ashby' | 'lever'

export const BOARD_NAMES: Record<AutofillBoard, string> = { greenhouse: 'Greenhouse', ashby: 'Ashby', lever: 'Lever' }

export interface AutofillField {
  label: string
  value: string
}

export interface AutofillReport {
  roleId: string
  url: string
  /** '' only when nothing was opened (empty profile). */
  board: AutofillBoard | ''
  filled: AutofillField[]
  /** Required fields left for the user, e.g. an essay or a question with no saved answer. */
  needsYou: string[]
  resumeAttached: boolean
  /** File name of the resume that was attached (the role's track resume, else the profile's), or null. */
  resumeFile: string | null
  /** True when the profile had nothing to fill from; no window was opened. */
  profileEmpty: boolean
  /** Short notes for the user, e.g. why the resume wasn't attached. */
  notes: string[]
}

export type AutofillStep = 'opening' | 'filling' | 'resume' | 'done' | 'failed'

export interface AutofillProgress {
  roleId: string
  step: AutofillStep
  message: string
}

export interface AutofillChannels {
  /** Opens the application (Greenhouse, Ashby or Lever) in its own window and fills it from the profile. Never submits. */
  'autofill:open': { req: { roleId: string }; res: AutofillReport }
  /** Whether a link is an application autofill can fill, and on which board. */
  'autofill:supported': { req: { url: string }; res: { supported: boolean; board: AutofillBoard | '' } }
}

export interface AutofillEvents {
  'autofill:report': AutofillReport
  'autofill:progress': AutofillProgress
}
