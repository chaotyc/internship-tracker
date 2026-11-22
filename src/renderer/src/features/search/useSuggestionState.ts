import { useSyncExternalStore } from 'react'
import { api } from '@renderer/lib/api'

/** What the top bar needs to know about the suggestions tray: how many are waiting and whether it is showing. */
interface SuggestionState {
  /** Suggestions still waiting (status 'new'), or null before the first load. */
  count: number | null
  trayOpen: boolean
}

let state: SuggestionState = { count: null, trayOpen: false }
const subs = new Set<() => void>()

export function setSuggestionState(patch: Partial<SuggestionState>): void {
  if (Object.entries(patch).every(([k, v]) => state[k as keyof SuggestionState] === v)) return
  state = { ...state, ...patch }
  for (const fn of subs) fn()
}

/** Reads the waiting-suggestion count from the store, for when the tray has not loaded them yet. */
export function loadSuggestionCount(): void {
  api
    .invoke('search:suggestions')
    .then((s) => setSuggestionState({ count: s.length }))
    .catch(() => {})
}

const subscribe = (fn: () => void) => {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

export function useSuggestionState(): SuggestionState {
  return useSyncExternalStore(subscribe, () => state)
}
