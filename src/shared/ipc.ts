import type { RolesChannels, RolesEvents } from './roles'
import type { ProfileChannels, ProfileEvents } from './profile'
import type { AiChannels, AiEvents } from './ai'
import type { SearchChannels, SearchEvents } from './search'
import type { ChatChannels, ChatEvents } from './chat'
import type { AutofillChannels, AutofillEvents } from './autofill'
import type { TodayChannels, TodayEvents } from './today'

/** Every renderer -> main request, keyed by channel. Each feature owns its own map. */
export interface IpcChannels
  extends RolesChannels,
    ProfileChannels,
    AiChannels,
    SearchChannels,
    ChatChannels,
    AutofillChannels,
    TodayChannels {}

/** Every main -> renderer push event. */
export interface IpcEvents
  extends RolesEvents,
    ProfileEvents,
    AiEvents,
    SearchEvents,
    ChatEvents,
    AutofillEvents,
    TodayEvents {}

export type Channel = keyof IpcChannels
export type Req<C extends Channel> = IpcChannels[C]['req']
export type Res<C extends Channel> = IpcChannels[C]['res']
export type EventName = keyof IpcEvents

/** What crosses the bridge: errors travel as data so their message survives. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface Api {
  invoke<C extends Channel>(channel: C, ...req: Req<C> extends void ? [] : [Req<C>]): Promise<Res<C>>
  on<E extends EventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
}
