import type { AiRequest, AiResult, ProviderStatus } from '@shared/ai'

export interface CompleteOptions {
  /** Called with each new piece of text as it streams. */
  onDelta?: (delta: string) => void
  signal?: AbortSignal
}

/** What other features use to talk to a model. Implemented by the ai feature. */
export interface AiService {
  complete(req: AiRequest, opts?: CompleteOptions): Promise<AiResult>
  /** Asks for JSON and parses the reply; throws with a readable message if it isn't JSON. */
  json<T>(req: AiRequest, opts?: CompleteOptions): Promise<T>
  status(): Promise<ProviderStatus[]>
}

/** Placeholder until the ai feature lands. */
export class StubAiService implements AiService {
  async complete(): Promise<AiResult> {
    throw new Error('No AI connection is set up yet. Open Settings, then AI connections.')
  }
  async json<T>(): Promise<T> {
    throw new Error('No AI connection is set up yet. Open Settings, then AI connections.')
  }
  async status(): Promise<ProviderStatus[]> {
    return []
  }
}
