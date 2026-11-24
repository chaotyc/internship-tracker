import { isOnboardingStep, type OnboardingOutcome, type OnboardingState } from '@shared/onboarding'

/** Settings key for the tour's state. Cleared with everything else by Delete everything. */
export const ONBOARDING_KEY = 'onboarding.state'

const OUTCOMES: OnboardingOutcome[] = ['completed', 'skipped', 'existing']

type SettingsLike = { get<T>(key: string, fallback: T): T; set<T>(key: string, value: T): void }

/** The saved state, or null if the tour hasn't been finished or skipped. Unreadable values count as null. */
export function readState(settings: SettingsLike): OnboardingState | null {
  const raw = settings.get<unknown>(ONBOARDING_KEY, null)
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!OUTCOMES.includes(r['outcome'] as OnboardingOutcome)) return null
  return {
    outcome: r['outcome'] as OnboardingOutcome,
    at: typeof r['at'] === 'string' ? r['at'] : '',
    step: isOnboardingStep(r['step']) ? r['step'] : null,
  }
}

export function writeState(settings: SettingsLike, state: OnboardingState): OnboardingState {
  settings.set(ONBOARDING_KEY, state)
  return state
}

/**
 * Whether the tour opens by itself. Never in demo mode (screenshots and smoke tests),
 * never once it has been finished or skipped, and not for a board that already has
 * roles: that data folder was set up before the tour existed.
 */
export function shouldShow(opts: { state: OnboardingState | null; demo: boolean; roleCount: number }): boolean {
  return !opts.demo && !opts.state && opts.roleCount === 0
}
