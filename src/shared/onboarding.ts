/**
 * First-run welcome tour. The main process remembers whether it has been
 * finished or skipped (in the settings table), so it shows once per data folder.
 */

/** The tour's steps, in order. */
export const ONBOARDING_STEPS = ['welcome', 'ai', 'profile', 'roles', 'done'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export function isOnboardingStep(x: unknown): x is OnboardingStep {
  return typeof x === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(x)
}

/**
 * How the tour ended. `existing`: never shown, because the data folder already
 * had roles from before the tour existed.
 */
export type OnboardingOutcome = 'completed' | 'skipped' | 'existing'

export interface OnboardingState {
  outcome: OnboardingOutcome
  /** ISO time it was recorded. */
  at: string
  /** The step the tour was on when it was closed. */
  step: OnboardingStep | null
}

export interface OnboardingStatus {
  /** True when the tour should open by itself: first launch, nothing on the board, not demo mode. */
  show: boolean
  state: OnboardingState | null
  /** False when this computer has no keychain, so API keys can't be saved. */
  canStoreKeys: boolean
  demo: boolean
}

export interface OnboardingChannels {
  'onboarding:status': { req: void; res: OnboardingStatus }
  /** Records that the tour was finished or closed, so it doesn't open by itself again. */
  'onboarding:finish': { req: { outcome: 'completed' | 'skipped'; step: OnboardingStep }; res: OnboardingStatus }
}

export interface OnboardingEvents {}
