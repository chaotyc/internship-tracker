import type { RoleInput } from './roles'
import type { SearchPreferences, SavedAnswer } from './profile'

/** Changes the assistant proposes. Nothing applies until the user confirms it in the sidebar. */
export type ChatAction =
  | { kind: 'add_role'; role: RoleInput }
  | { kind: 'update_preferences'; preferences: Partial<SearchPreferences> }
  | { kind: 'save_answers'; answers: Omit<SavedAnswer, 'id'>[] }
  | { kind: 'move_role'; roleId: string; stage: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** The role the user had open when they asked, if any. */
  roleId: string | null
  actions: { action: ChatAction; state: 'proposed' | 'applied' | 'dismissed' }[]
}

export interface ChatChannels {
  'chat:history': { req: void; res: ChatMessage[] }
  /** Streams the reply through chat:delta, then resolves with the saved message. */
  'chat:send': { req: { text: string; roleId: string | null }; res: ChatMessage }
  'chat:stop': { req: void; res: void }
  'chat:applyAction': { req: { messageId: string; index: number }; res: ChatMessage }
  'chat:dismissAction': { req: { messageId: string; index: number }; res: ChatMessage }
  'chat:clear': { req: void; res: void }
}

export interface ChatEvents {
  'chat:delta': { messageId: string; text: string }
}
