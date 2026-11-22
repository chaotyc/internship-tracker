import { EMPTY_PROFILE, type Profile } from '@shared/profile'
import type { Settings } from '../../settings'

export interface ProfileService {
  get(): Profile
  save(profile: Profile): Profile
}

/** Placeholder: plain settings storage. The profile feature replaces it with encrypted storage. */
export class StubProfileService implements ProfileService {
  constructor(private readonly settings: Settings) {}
  get(): Profile {
    return { ...EMPTY_PROFILE, ...this.settings.get<Partial<Profile>>('profile', {}) }
  }
  save(profile: Profile): Profile {
    this.settings.set('profile', profile)
    return this.get()
  }
}
