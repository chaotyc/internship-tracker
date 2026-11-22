import { randomUUID } from 'node:crypto'
import type { ChatAction, ChatActionState, ChatMessage } from '@shared/chat'
import type { Migration, Store } from '../../db/store'

export const chatMigrations: Migration[] = [
  {
    id: 'chat-001',
    sql: `CREATE TABLE chat_messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      role_id TEXT,
      actions TEXT NOT NULL DEFAULT '[]',
      stopped INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );`,
  },
]

type Row = { id: string; role: string; content: string; role_id: string | null; actions: string; stopped: number; created_at: string }

function fromRow(r: Row): ChatMessage {
  let actions: ChatMessage['actions'] = []
  try {
    const parsed = JSON.parse(r.actions) as unknown
    if (Array.isArray(parsed)) actions = parsed as ChatMessage['actions']
  } catch {
    actions = []
  }
  const msg: ChatMessage = {
    id: r.id,
    role: r.role === 'assistant' ? 'assistant' : 'user',
    content: r.content,
    createdAt: r.created_at,
    roleId: r.role_id ?? null,
    actions,
  }
  if (r.stopped) msg.stopped = true
  return msg
}

/** The one running conversation, oldest message first. */
export class ChatStore {
  constructor(private readonly store: Store) {}

  list(limit = 500): ChatMessage[] {
    return this.store
      .all<Row>('SELECT * FROM (SELECT * FROM chat_messages ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC', [limit])
      .map(fromRow)
  }

  get(id: string): ChatMessage | null {
    const r = this.store.get<Row>('SELECT * FROM chat_messages WHERE id = ?', [id])
    return r ? fromRow(r) : null
  }

  last(): ChatMessage | null {
    const r = this.store.get<Row>('SELECT * FROM chat_messages ORDER BY seq DESC LIMIT 1')
    return r ? fromRow(r) : null
  }

  add(m: {
    id?: string
    role: ChatMessage['role']
    content: string
    roleId: string | null
    actions?: ChatAction[]
    stopped?: boolean
  }): ChatMessage {
    const id = m.id ?? randomUUID()
    const actions = (m.actions ?? []).map((action) => ({ action, state: 'proposed' as ChatActionState }))
    this.store.run('INSERT INTO chat_messages (id, role, content, role_id, actions, stopped, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      id,
      m.role,
      m.content,
      m.roleId,
      JSON.stringify(actions),
      m.stopped ? 1 : 0,
      new Date().toISOString(),
    ])
    return this.get(id)!
  }

  setActionState(messageId: string, index: number, state: ChatActionState): ChatMessage {
    const msg = this.get(messageId)
    if (!msg) throw new Error('That message is no longer in the conversation.')
    const item = msg.actions[index]
    if (!item) throw new Error('That suggestion is no longer available.')
    item.state = state
    this.store.run('UPDATE chat_messages SET actions = ? WHERE id = ?', [JSON.stringify(msg.actions), messageId])
    return msg
  }

  clear(): void {
    this.store.run('DELETE FROM chat_messages')
  }
}
