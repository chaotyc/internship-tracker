/** Everything about the applicant. Stored locally only; sensitive parts encrypted at rest. */
export interface Education {
  school: string
  degree: string
  field: string
  startDate: string
  endDate: string
  gpa: string
}

export type Choice = '' | 'decline' | string

export interface Demographics {
  gender: Choice
  pronouns: string
  hispanicLatino: Choice
  race: Choice
  veteran: Choice
  disability: Choice
}

export interface SearchPreferences {
  /** e.g. "ML inference intern", "photonics intern" */
  targetRoles: string[]
  locations: string[]
  remoteOk: boolean
  term: string
  minPay: string
  keywords: string[]
  excludeKeywords: string[]
  notes: string
}

export interface SavedAnswer {
  id: string
  question: string
  answer: string
}

export interface Profile {
  legalFirstName: string
  legalLastName: string
  preferredName: string
  email: string
  phone: string
  city: string
  region: string
  country: string
  linkedin: string
  github: string
  website: string
  scholar: string
  education: Education[]
  authorizedToWorkUS: boolean | null
  needsSponsorship: boolean | null
  demographics: Demographics
  preferences: SearchPreferences
  /** Reusable answers: SAT score, "how did you hear about us", start date, etc. */
  answers: SavedAnswer[]
  resume: { fileName: string; storedPath: string; text: string; updatedAt: string } | null
}

export const EMPTY_PROFILE: Profile = {
  legalFirstName: '',
  legalLastName: '',
  preferredName: '',
  email: '',
  phone: '',
  city: '',
  region: '',
  country: '',
  linkedin: '',
  github: '',
  website: '',
  scholar: '',
  education: [],
  authorizedToWorkUS: null,
  needsSponsorship: null,
  demographics: { gender: '', pronouns: '', hispanicLatino: '', race: '', veteran: '', disability: '' },
  preferences: {
    targetRoles: [],
    locations: [],
    remoteOk: true,
    term: '',
    minPay: '',
    keywords: [],
    excludeKeywords: [],
    notes: '',
  },
  answers: [],
  resume: null,
}

export interface ProfileChannels {
  'profile:get': { req: void; res: Profile }
  'profile:save': { req: Profile; res: Profile }
  /** Opens a file picker, stores a copy of the resume and extracts its text. */
  'profile:importResume': { req: void; res: Profile | null }
  /** Writes a JSON export the user chooses a location for. */
  'profile:exportAll': { req: void; res: { path: string } | null }
  /** Deletes every local record: roles, profile, chats, keys. */
  'profile:deleteAll': { req: void; res: void }
}

export interface ProfileEvents {
  'profile:changed': Record<string, never>
}
