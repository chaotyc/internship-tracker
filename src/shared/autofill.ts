export interface AutofillField {
  label: string
  value: string
}

export interface AutofillReport {
  roleId: string
  url: string
  filled: AutofillField[]
  /** Required fields left for the user, e.g. an essay or a question with no saved answer. */
  needsYou: string[]
  resumeAttached: boolean
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
  /** Opens the application in its own window and fills it from the profile. Never submits. */
  'autofill:open': { req: { roleId: string }; res: AutofillReport }
  'autofill:supported': { req: { url: string }; res: { supported: boolean; board: string } }
}

export interface AutofillEvents {
  'autofill:report': AutofillReport
  'autofill:progress': AutofillProgress
}
