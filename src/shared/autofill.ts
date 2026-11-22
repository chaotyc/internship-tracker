export interface AutofillField {
  label: string
  value: string
}

export interface AutofillReport {
  url: string
  filled: AutofillField[]
  /** Required fields left for the user, e.g. an essay or a question with no saved answer. */
  needsYou: string[]
  resumeAttached: boolean
}

export interface AutofillChannels {
  /** Opens the application in its own window and fills it from the profile. Never submits. */
  'autofill:open': { req: { roleId: string }; res: AutofillReport }
  'autofill:supported': { req: { url: string }; res: { supported: boolean; board: string } }
}

export interface AutofillEvents {
  'autofill:report': AutofillReport
}
